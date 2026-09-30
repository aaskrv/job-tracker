import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const INBOX_DIR = path.join(DATA_DIR, 'inbox');
export const IMPORTED_DIR = path.join(DATA_DIR, 'imported');
export const FAILED_DIR = path.join(DATA_DIR, 'failed');
const COLLECTOR_CONFIG = path.join(ROOT, 'collector.config.json');

export const env = {
  databaseUrl: process.env.DATABASE_URL || 'postgres://jobtracker:jobtracker@localhost:5433/jobtracker',
  port: Number(process.env.PORT || 3000),
  inboxPollSeconds: Number(process.env.INBOX_POLL_SECONDS || 60),
};

for (const dir of [INBOX_DIR, IMPORTED_DIR, FAILED_DIR]) fs.mkdirSync(dir, { recursive: true });

// collector.config.json is shared between the app and the collector (Claude in Chrome):
// the collector reads it before every run and does nothing while "enabled" is false.
export function readCollectorConfig() {
  return JSON.parse(fs.readFileSync(COLLECTOR_CONFIG, 'utf8'));
}

export function writeCollectorConfig(cfg) {
  fs.writeFileSync(COLLECTOR_CONFIG, JSON.stringify(cfg, null, 2) + '\n');
}
