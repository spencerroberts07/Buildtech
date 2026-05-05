import { query } from './db.js';

// Ensure a material row exists with the given (name, unit). Returns its id.
// SELECT-then-INSERT (not ON CONFLICT) because materials.name has no UNIQUE
// constraint — existing data may contain duplicates we do not want to break.
export async function ensureMaterial(name, unit) {
  const existing = await query(
    'SELECT id FROM materials WHERE name = $1 LIMIT 1',
    [name]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;
  const inserted = await query(
    'INSERT INTO materials (name, unit) VALUES ($1, $2) RETURNING id',
    [name, unit]
  );
  return inserted.rows[0].id;
}
