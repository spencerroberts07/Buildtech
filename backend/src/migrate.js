import { pool } from './db.js';
import bcrypt from 'bcryptjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assemblies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assembly_items (
  id SERIAL PRIMARY KEY,
  assembly_id INTEGER NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  quantity_per_unit NUMERIC NOT NULL,
  waste_factor NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  customer TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS measurements (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  assembly_id INTEGER REFERENCES assemblies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  default_wall_height NUMERIC NOT NULL DEFAULT 9,
  exterior_sheathing TEXT NOT NULL DEFAULT '7/16_osb',
  roof_sheathing TEXT NOT NULL DEFAULT '1/2_csp',
  drywall TEXT NOT NULL DEFAULT '1/2_drywall',
  stud_spacing NUMERIC NOT NULL DEFAULT 16,
  corner_style TEXT NOT NULL DEFAULT '3_stud',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT settings_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS walls (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  x1 NUMERIC NOT NULL,
  y1 NUMERIC NOT NULL,
  x2 NUMERIC NOT NULL,
  y2 NUMERIC NOT NULL,
  height NUMERIC,
  wall_type TEXT NOT NULL,
  sheathing_override TEXT,
  drywall_override TEXT,
  extra_corner_studs INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS walls_project_id_idx ON walls(project_id);

CREATE TABLE IF NOT EXISTS openings (
  id SERIAL PRIMARY KEY,
  wall_id INTEGER NOT NULL REFERENCES walls(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'window',
  rough_opening_width NUMERIC NOT NULL,
  rough_opening_height NUMERIC NOT NULL,
  label TEXT,
  position_along_wall NUMERIC NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS openings_project_id_idx ON openings(project_id);
CREATE INDEX IF NOT EXISTS openings_wall_id_idx ON openings(wall_id);
`;

const PROJECT_COLUMN_ALTERS = [
  // Project-level overrides for settings (NULL = inherit global)
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_wall_height NUMERIC`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS exterior_sheathing TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS roof_sheathing TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS drywall TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS stud_spacing NUMERIC`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS corner_style TEXT`,
  // Sketch / canvas settings (these have project-level defaults, not global)
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS scale_ft_per_grid NUMERIC NOT NULL DEFAULT 1`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS viewport_pan_x NUMERIC NOT NULL DEFAULT 0`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS viewport_pan_y NUMERIC NOT NULL DEFAULT 0`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS viewport_zoom NUMERIC NOT NULL DEFAULT 1`,
  // Insulation selection (project-level)
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS insulation_type TEXT NOT NULL DEFAULT 'pink_r22_15'`,
  // Silverboard exterior rigid insulation
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS silverboard_type TEXT NOT NULL DEFAULT 'silverboard_1'`,
  // Project setup metadata
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS num_storeys INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS floor2_wall_height INTEGER NOT NULL DEFAULT 9`,
];

async function ensureSettings() {
  await pool.query(`
    INSERT INTO settings (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);
}

async function ensureUser() {
  const username = 'admin';
  const password = 'changeme';
  const existing = await pool.query('SELECT id FROM users WHERE username=$1', [username]);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hash]);
    console.log(`Seeded user: ${username} / ${password}`);
  }
}

async function seedExamples() {
  const { rowCount } = await pool.query('SELECT 1 FROM materials LIMIT 1');
  if (rowCount > 0) return;

  console.log('Seeding example materials and assemblies...');

  const materials = [
    ['2x6x8 SPF stud', 'each'],
    ['2x6x10 SPF plate', 'each'],
    ['7/16 OSB sheathing 4x8', 'sheet'],
    ['Housewrap', 'sf'],
    ['R20 batt insulation', 'sf'],
    ['1/2 drywall 4x8', 'sheet'],
    ['Drywall screws 1-5/8 (lb)', 'lb'],
    ['Joint compound (5gal)', 'pail'],
    ['2x10x12 SPF joist', 'each'],
    ['3/4 T&G subfloor 4x8', 'sheet'],
  ];

  const matIds = {};
  for (const [name, unit] of materials) {
    const r = await pool.query(
      'INSERT INTO materials (name, unit) VALUES ($1, $2) RETURNING id',
      [name, unit]
    );
    matIds[name] = r.rows[0].id;
  }

  // Example assembly: Exterior 2x6 wall, per linear foot, 9ft tall
  const wall = await pool.query(
    `INSERT INTO assemblies (name, unit, description)
     VALUES ($1, $2, $3) RETURNING id`,
    ['Exterior 2x6 wall (9ft)', 'linear foot', '2x6 framed wall, 16" o.c., sheathed, wrapped, insulated']
  );
  const wallId = wall.rows[0].id;

  const wallItems = [
    ['2x6x8 SPF stud', 0.75, 0.05],
    ['2x6x10 SPF plate', 0.3, 0.05],
    ['7/16 OSB sheathing 4x8', 0.28, 0.10],
    ['Housewrap', 9, 0.10],
    ['R20 batt insulation', 9, 0.05],
    ['1/2 drywall 4x8', 0.28, 0.10],
  ];
  for (const [name, qty, waste] of wallItems) {
    await pool.query(
      `INSERT INTO assembly_items (assembly_id, material_id, quantity_per_unit, waste_factor)
       VALUES ($1, $2, $3, $4)`,
      [wallId, matIds[name], qty, waste]
    );
  }

  // Example assembly: Floor system per square foot
  const floor = await pool.query(
    `INSERT INTO assemblies (name, unit, description)
     VALUES ($1, $2, $3) RETURNING id`,
    ['Floor system 2x10 @ 16 o.c.', 'square foot', 'Floor joists with 3/4 T&G subfloor']
  );
  const floorId = floor.rows[0].id;
  const floorItems = [
    ['2x10x12 SPF joist', 0.083, 0.05],
    ['3/4 T&G subfloor 4x8', 0.032, 0.10],
  ];
  for (const [name, qty, waste] of floorItems) {
    await pool.query(
      `INSERT INTO assembly_items (assembly_id, material_id, quantity_per_unit, waste_factor)
       VALUES ($1, $2, $3, $4)`,
      [floorId, matIds[name], qty, waste]
    );
  }

  console.log('Seed complete.');
}

async function run() {
  try {
    await pool.query(SCHEMA);
    console.log('Schema ensured.');
    for (const stmt of PROJECT_COLUMN_ALTERS) {
      await pool.query(stmt);
    }
    console.log('Project columns ensured.');
    await ensureSettings();
    console.log('Settings row ensured.');
    await ensureUser();
    await seedExamples();
    console.log('Migration done.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
