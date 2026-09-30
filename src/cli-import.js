// Usage: npm run import -- path/to/file.json   (without a path: processes data/inbox)
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { importPayload } from './importer.js';
import { processInbox } from './inbox.js';

const file = process.argv[2];
try {
  await migrate({ log: () => {} });
  if (file) {
    const stats = await importPayload(JSON.parse(fs.readFileSync(file, 'utf8')), { fileName: path.basename(file) });
    console.log(stats);
  } else {
    const results = await processInbox();
    if (!results.length) console.log('inbox is empty');
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
