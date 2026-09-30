import pg from 'pg';
import { env } from './config.js';

// NUMERIC -> JS number (salaries fit comfortably)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// INT8 (COUNT, BIGSERIAL) -> JS number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: env.databaseUrl });

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
