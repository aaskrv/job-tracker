import fs from 'node:fs';
import path from 'node:path';
import { INBOX_DIR, IMPORTED_DIR, FAILED_DIR } from './config.js';
import { importPayload } from './importer.js';

let running = false;

export function listInbox() {
  return fs.readdirSync(INBOX_DIR).filter((f) => f.endsWith('.json')).sort();
}

// Imports every *.json in data/inbox, then moves it to data/imported (or data/failed).
export async function processInbox({ log = console.log } = {}) {
  if (running) return [];
  running = true;
  const results = [];
  try {
    for (const file of listInbox()) {
      const src = path.join(INBOX_DIR, file);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try {
        const payload = JSON.parse(fs.readFileSync(src, 'utf8'));
        const stats = await importPayload(payload, { fileName: file });
        fs.renameSync(src, path.join(IMPORTED_DIR, `${stamp}_${file}`));
        log(`inbox: ${file} -> +${stats.inserted} new, ${stats.updated} updated, ${stats.duplicates} dup, ${stats.errors} errors`);
        results.push({ file, ok: true, stats });
      } catch (e) {
        fs.renameSync(src, path.join(FAILED_DIR, `${stamp}_${file}`));
        fs.writeFileSync(path.join(FAILED_DIR, `${stamp}_${file}.error.txt`), String(e.stack || e));
        log(`inbox: ${file} failed: ${e.message}`);
        results.push({ file, ok: false, error: e.message });
      }
    }
  } finally {
    running = false;
  }
  return results;
}
