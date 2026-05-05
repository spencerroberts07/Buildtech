import { pool } from './db.js';

const TABLES = ['walls', 'settings', 'projects'];

async function run() {
  try {
    for (const t of TABLES) {
      const { rows } = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = $1
         ORDER BY ordinal_position`,
        [t]
      );
      console.log(`\n=== ${t} ===`);
      if (rows.length === 0) {
        console.log('  (table does not exist)');
        continue;
      }
      for (const r of rows) {
        const nullable = r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const def = r.column_default ? ` default ${r.column_default}` : '';
        console.log(`  ${r.column_name.padEnd(28)} ${r.data_type.padEnd(28)} ${nullable}${def}`);
      }
    }

    console.log('\n=== settings row ===');
    const { rows: s } = await pool.query('SELECT * FROM settings WHERE id = 1');
    console.log(s[0] || '(no row)');

    console.log('\n=== walls row count ===');
    const { rows: w } = await pool.query('SELECT COUNT(*)::int AS n FROM walls');
    console.log(`walls: ${w[0].n}`);
  } catch (err) {
    console.error('verify-schema failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
