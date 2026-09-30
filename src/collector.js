import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './config.js';
import { query } from './db.js';

const TOOLS = 'Read,Write,Glob,Bash(date),mcp__claude-in-chrome';
const VACANCY_URL = /\/jobs\/view\/|[?&]jk=|\/vacancy\/\d+/;
const prompt = (sources) => `Ручной запуск сборщика по docs/COLLECTOR.md: только площадки ${sources.join(', ')}. Цели из targets и ограничения площадок брать из docs/COLLECTOR.md.`;

// ponytail: the current run lives in memory, a server restart mid-run loses it and its usage
let current = null;

const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

function describe(tool) {
  const name = tool.name.replace(/^mcp__claude-in-chrome__/, '');
  const input = tool.input || {};
  if (input.url) return `Открывает ${String(input.url).slice(0, 140)}`;
  if (input.file_path) return `${name === 'Write' ? 'Сохраняет' : 'Читает'} ${path.basename(input.file_path)}`;
  return `Chrome: ${name}`;
}

async function saveRun(run, code, out, errorText) {
  const models = Object.values(out?.modelUsage ?? {});
  const sum = (key) => (out ? models.reduce((s, m) => s + (m[key] || 0), 0) : null);
  const failed = code !== 0 || !out || out.is_error;
  await query(
    `INSERT INTO collector_runs (started_at, sources, exit_code, error, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, num_turns, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [run.startedAt, run.sources, code, failed ? errorText || out?.subtype || 'нет ответа' : null,
      sum('inputTokens'), sum('outputTokens'), sum('cacheReadInputTokens'), sum('cacheCreationInputTokens'),
      out?.total_cost_usd ?? null, out?.num_turns ?? null, out?.result ?? null]);
}

/** Progress of the manual run in flight, or null when nothing is running. */
export const runStatus = () => current;

/** Starts `claude -p --chrome` for the given sources and records its usage in collector_runs when it exits. */
export function startRun(sources) {
  const run = { startedAt: new Date(), sources, expectedSec: null, steps: 0, vacancies: 0, tokens: 0, lastAction: null, lastEventAt: new Date() };
  current = run;
  query(`SELECT extract(epoch FROM avg(finished_at - started_at))::int AS sec FROM collector_runs WHERE error IS NULL`)
    .then(({ rows }) => { run.expectedSec = rows[0].sec; })
    .catch(() => {});

  const child = spawn('claude', ['-p', prompt(sources), '--chrome', '--allowedTools', TOOLS, '--output-format', 'stream-json', '--verbose'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  const tokensByMessage = new Map();
  let result = null;
  let pending = '';
  let stray = '';
  let stderr = '';

  const onLine = (line) => {
    const e = parseJson(line);
    if (!e) {
      if (line.trim()) stray = (stray + line + '\n').slice(-2000);
      return;
    }
    run.lastEventAt = new Date();
    if (e.type === 'result') result = e;
    if (e.type !== 'assistant') return;
    const { id, usage = {}, content = [] } = e.message;
    const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    run.tokens += tokens - (tokensByMessage.get(id) || 0);
    tokensByMessage.set(id, tokens);
    for (const c of content) {
      if (c.type !== 'tool_use') continue;
      run.steps++;
      run.lastAction = describe(c);
      if (VACANCY_URL.test(c.input?.url || '')) run.vacancies++;
    }
  };

  child.stdout.on('data', (chunk) => {
    const lines = (pending + chunk).split('\n');
    pending = lines.pop();
    lines.forEach(onLine);
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });

  let finished = false;
  const finish = (code, spawnError) => {
    if (finished) return;
    finished = true;
    if (pending) onLine(pending);
    saveRun(run, code, result, spawnError ?? (stderr.trim() || stray.trim()))
      .catch((e) => console.error('collector run:', e.message))
      .finally(() => { if (current === run) current = null; });
  };
  child.on('error', (e) => finish(null, e.message));
  child.on('close', (code) => finish(code));
}
