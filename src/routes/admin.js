import express from 'express';
import { query } from '../db.js';
import { readCollectorConfig, writeCollectorConfig } from '../config.js';
import { importPayload } from '../importer.js';
import { listInbox, processInbox } from '../inbox.js';
import { dashboardStats, pct } from '../stats.js';
import { normalizeSalary } from '../normalize.js';

export const router = express.Router();

router.get('/', async (req, res) => {
  const stats = await dashboardStats();
  res.render('dashboard', { title: 'Дашборд', s: stats, pct, collector: readCollectorConfig() });
});

router.get('/import', async (req, res) => {
  const { rows: runs } = await query('SELECT * FROM scrape_runs ORDER BY imported_at DESC LIMIT 50');
  res.render('import', { title: 'Импорт', runs, inbox: listInbox(), msg: req.query.msg });
});

// Called from the browser with the parsed JSON file as the body
router.post('/import', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const stats = await importPayload(req.body, { fileName: decodeURIComponent(req.get('X-File-Name') || 'upload.json') });
    res.json({ ok: true, stats });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/import/inbox', async (req, res) => {
  const results = await processInbox();
  const ok = results.filter((r) => r.ok).length;
  res.redirect(`/import?msg=${encodeURIComponent(`Обработано файлов: ${ok} из ${results.length}`)}`);
});

router.get('/settings', (req, res) => {
  const cfg = readCollectorConfig();
  res.render('settings', { title: 'Настройки сбора', cfg, json: JSON.stringify(cfg, null, 2), msg: req.query.msg, error: null });
});

router.post('/settings/toggle', (req, res) => {
  const cfg = readCollectorConfig();
  cfg.enabled = req.body.enabled === 'true';
  writeCollectorConfig(cfg);
  res.redirect('/settings?msg=' + encodeURIComponent(cfg.enabled ? 'Регулярный сбор включён' : 'Регулярный сбор выключен'));
});

router.post('/settings', (req, res) => {
  try {
    const cfg = JSON.parse(req.body.json);
    if (typeof cfg.enabled !== 'boolean') throw new Error('"enabled" must be true or false');
    if (!cfg.salary?.fx_to_usd || !cfg.salary?.net_ratio_by_country) throw new Error('"salary.fx_to_usd" and "salary.net_ratio_by_country" are required');
    writeCollectorConfig(cfg);
    res.redirect('/settings?msg=' + encodeURIComponent('Сохранено'));
  } catch (e) {
    const cfg = readCollectorConfig();
    res.status(400).render('settings', { title: 'Настройки сбора', cfg, json: req.body.json, msg: null, error: e.message });
  }
});

// Re-applies the current threshold, FX rates and net ratios to every stored salary
router.post('/settings/recalc', async (req, res) => {
  const cfg = readCollectorConfig();
  const { rows } = await query(
    `SELECT id, location_country, salary_min, salary_max, salary_currency, salary_period, salary_type
     FROM vacancies WHERE salary_min IS NOT NULL OR salary_max IS NOT NULL`);
  for (const v of rows) {
    const s = normalizeSalary({ min: v.salary_min, max: v.salary_max, currency: v.salary_currency, period: v.salary_period, type: v.salary_type }, v.location_country, cfg);
    await query('UPDATE vacancies SET salary_net_usd_min=$2, salary_net_usd_max=$3, salary_fit=$4 WHERE id=$1', [v.id, s.netMin, s.netMax, s.fit]);
  }
  res.redirect('/settings?msg=' + encodeURIComponent(`Пересчитано вакансий: ${rows.length}`));
});

// Machine-readable endpoints (handy for scripts and the collector)
router.get('/api/collector-config', (req, res) => res.json(readCollectorConfig()));
router.get('/api/stats', async (req, res) => res.json(await dashboardStats()));
