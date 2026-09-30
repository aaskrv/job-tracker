import express from 'express';
import fs from 'node:fs';
import { query } from '../db.js';
import { readCollectorConfig, writeCollectorConfig, MASTER_CV } from '../config.js';
import { dashboardStats, pct } from '../stats.js';
import { normalizeSalary } from '../normalize.js';
import { runStatus, startRun } from '../collector.js';

export const router = express.Router();

router.get('/', async (req, res) => {
  const cfg = readCollectorConfig();
  if (cfg.onboarded === false) return res.redirect('/profile');
  const stats = await dashboardStats();
  res.render('dashboard', { title: 'Дашборд', s: stats, pct, collector: cfg });
});

const recentRuns = async () => (await query('SELECT * FROM scrape_runs ORDER BY imported_at DESC LIMIT 50')).rows;
const masterCv = () => fs.statSync(MASTER_CV, { throwIfNoEntry: false });
const list = (v) => [].concat(v ?? []).map((s) => s.trim()).filter(Boolean);

function configProblems(cfg) {
  const t = cfg.targets || {};
  const sources = cfg.sources || [];
  const numbers = [cfg.max_vacancies_per_source, cfg.max_age_days, cfg.ghosted_after_days, cfg.salary?.min_net_usd_month];
  return [
    !sources.length && 'Выбери хотя бы одну площадку',
    !cfg.queries?.length && 'Нужен хотя бы один поисковый запрос',
    !t.remote && !t.relocation_countries?.length && !t.kazakhstan && 'Выбери, где искать: удалёнка, релокация или Казахстан',
    sources.length && sources.every((s) => s === 'hh') && !t.kazakhstan && 'hh.kz ищет только по Казахстану: включи Казахстан или добавь другую площадку',
    !numbers.every((n) => Number.isInteger(n) && n >= 0) && 'Числа должны быть целыми и не меньше нуля',
  ].filter(Boolean);
}

const runProblems = (cfg) => [
  cfg.onboarded === false && 'Профиль ещё не заполнен',
  !masterCv() && 'Не загружено мастер-CV: без него сборщику не с чем сравнивать вакансии',
  ...configProblems(cfg),
].filter(Boolean);

const renderProfile = (res, cfg, { msg = null, error = null, json = null } = {}) =>
  res.status(error ? 400 : 200).render('profile', {
    title: 'Профиль', cfg, cv: masterCv(), msg, error, jsonOpen: json !== null, json: json ?? JSON.stringify(cfg, null, 2),
  });

// Re-applies the current threshold, FX rates and net ratios to every stored salary
async function recalcSalaries(cfg) {
  const { rows } = await query(
    `SELECT id, location_country, salary_min, salary_max, salary_currency, salary_period, salary_type
     FROM vacancies WHERE salary_min IS NOT NULL OR salary_max IS NOT NULL`);
  for (const v of rows) {
    const s = normalizeSalary({ min: v.salary_min, max: v.salary_max, currency: v.salary_currency, period: v.salary_period, type: v.salary_type }, v.location_country, cfg);
    await query('UPDATE vacancies SET salary_net_usd_min=$2, salary_net_usd_max=$3, salary_fit=$4 WHERE id=$1', [v.id, s.netMin, s.netMax, s.fit]);
  }
}

router.get('/profile', (req, res) => renderProfile(res, readCollectorConfig(), { msg: req.query.msg }));

router.post('/profile', async (req, res) => {
  const b = req.body;
  const cfg = readCollectorConfig();
  const next = {
    ...cfg,
    onboarded: true,
    sources: list(b.sources),
    queries: list(b.queries?.split('\n')),
    targets: {
      ...cfg.targets,
      remote: b.remote === '1',
      relocation_countries: list(b.relocation_countries),
      kazakhstan: b.kz === '1' ? { remote_from: b.kz_city, hybrid: b.kz_hybrid === '1' } : null,
    },
    max_vacancies_per_source: Number(b.max_vacancies_per_source),
    max_age_days: Number(b.max_age_days),
    ghosted_after_days: Number(b.ghosted_after_days),
    salary: { ...cfg.salary, min_net_usd_month: Number(b.min_net_usd_month) },
  };
  const problems = configProblems(next);
  if (problems.length) return renderProfile(res, next, { error: problems.join('; ') });
  writeCollectorConfig(next);
  await recalcSalaries(next);
  res.redirect('/profile?msg=' + encodeURIComponent('Профиль сохранён'));
});

router.post('/profile/json', async (req, res) => {
  try {
    const cfg = JSON.parse(req.body.json);
    if (typeof cfg.enabled !== 'boolean') throw new Error('"enabled" must be true or false');
    if (!cfg.salary?.fx_to_usd || !cfg.salary?.net_ratio_by_country) throw new Error('"salary.fx_to_usd" and "salary.net_ratio_by_country" are required');
    writeCollectorConfig(cfg);
    await recalcSalaries(cfg);
    res.redirect('/profile?msg=' + encodeURIComponent('Сохранено'));
  } catch (e) {
    renderProfile(res, readCollectorConfig(), { error: e.message, json: req.body.json });
  }
});

// The browser sends the file as the raw request body (see public/app.js), so no multipart parser is needed
router.post('/profile/cv', express.raw({ type: 'application/pdf', limit: '10mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.subarray(0, 5).toString() !== '%PDF-') return res.status(400).send('Нужен PDF-файл');
  fs.writeFileSync(MASTER_CV + '.tmp', req.body);
  fs.renameSync(MASTER_CV + '.tmp', MASTER_CV);
  res.redirect('/profile?msg=' + encodeURIComponent('Мастер-CV обновлено'));
});

router.get('/cv/master.pdf', (req, res) => {
  if (!masterCv()) return res.status(404).render('error', { title: 'Не найдено', message: 'Мастер-CV ещё не загружено' });
  res.sendFile(MASTER_CV);
});

router.get('/settings', async (req, res) => {
  const cfg = readCollectorConfig();
  const collectorRuns = (await query('SELECT * FROM collector_runs ORDER BY started_at DESC LIMIT 20')).rows;
  res.render('settings', { title: 'Настройки сбора', cfg, problems: runProblems(cfg), runs: await recentRuns(), collectorRuns, msg: req.query.msg, error: req.query.error });
});

router.post('/settings/run', (req, res) => {
  if (runStatus()) return res.redirect('/settings?msg=' + encodeURIComponent('Сбор уже идёт'));
  const cfg = readCollectorConfig();
  const sources = list(req.body.sources).filter((s) => (cfg.sources || []).includes(s));
  const problems = runProblems({ ...cfg, sources });
  if (problems.length) return res.redirect('/settings?error=' + encodeURIComponent(problems.join('; ')));
  startRun(sources);
  res.redirect('/settings?msg=' + encodeURIComponent('Сбор запущен'));
});

router.post('/settings/toggle', (req, res) => {
  const cfg = readCollectorConfig();
  cfg.enabled = req.body.enabled === 'true';
  writeCollectorConfig(cfg);
  res.redirect('/settings?msg=' + encodeURIComponent(cfg.enabled ? 'Регулярный сбор включён' : 'Регулярный сбор выключен'));
});

// Machine-readable endpoints (handy for scripts and the collector)
router.get('/api/collector-config', (req, res) => res.json(readCollectorConfig()));
router.get('/api/stats', async (req, res) => res.json(await dashboardStats()));
router.get('/api/collector-status', async (req, res) => {
  const { rows } = await query('SELECT id, finished_at, error FROM collector_runs ORDER BY started_at DESC LIMIT 1');
  res.json({ running: runStatus(), lastRun: rows[0] ?? null });
});
