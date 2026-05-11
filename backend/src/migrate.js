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

CREATE TABLE IF NOT EXISTS floor_plans (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'floor1',
  corners JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS floor_plans_project_id_idx ON floor_plans(project_id);

CREATE TABLE IF NOT EXISTS floor_plan_walls (
  id SERIAL PRIMARY KEY,
  floor_plan_id INTEGER NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  wall_index INTEGER NOT NULL,
  wall_type TEXT NOT NULL DEFAULT 'exterior_2x6',
  height NUMERIC,
  sheathing_override TEXT,
  drywall_override TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS floor_plan_walls_fp_idx ON floor_plan_walls(floor_plan_id);

CREATE TABLE IF NOT EXISTS roofs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  width_ft NUMERIC NOT NULL,
  depth_ft NUMERIC NOT NULL,
  pitch TEXT NOT NULL DEFAULT '6:12',
  sheathing_type TEXT NOT NULL DEFAULT 'plywood_1_2_csp',
  rafter_spacing TEXT NOT NULL DEFAULT '24_oc',
  north_side TEXT NOT NULL DEFAULT 'gable',
  south_side TEXT NOT NULL DEFAULT 'gable',
  east_side TEXT NOT NULL DEFAULT 'gable',
  west_side TEXT NOT NULL DEFAULT 'gable',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS roofs_project_id_idx ON roofs(project_id);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS material_deletions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  section TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, description, section)
);

CREATE INDEX IF NOT EXISTS material_deletions_project_id_idx ON material_deletions(project_id);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS floor_plan_interior_walls (
  id SERIAL PRIMARY KEY,
  floor_plan_id INTEGER NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  x1 NUMERIC NOT NULL,
  y1 NUMERIC NOT NULL,
  x2 NUMERIC NOT NULL,
  y2 NUMERIC NOT NULL,
  wall_type TEXT NOT NULL DEFAULT 'interior_2x4',
  height NUMERIC,
  on_concrete BOOLEAN NOT NULL DEFAULT false,
  sheathing_override TEXT,
  drywall_override TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS floor_plan_interior_walls_fp_idx ON floor_plan_interior_walls(floor_plan_id);

CREATE TABLE IF NOT EXISTS packages (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  package_type TEXT NOT NULL DEFAULT 'custom',
  notes TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'PKG',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS packages_project_id_idx ON packages(project_id);

CREATE TABLE IF NOT EXISTS floors (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'floor1',
  floor_area_sf NUMERIC NOT NULL,
  subfloor_type TEXT NOT NULL DEFAULT '58tgcsp',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS floors_project_id_idx ON floors(project_id);

CREATE TABLE IF NOT EXISTS material_overrides (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_description TEXT NOT NULL,
  override_description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, original_description)
);

CREATE INDEX IF NOT EXISTS material_overrides_project_id_idx ON material_overrides(project_id);

CREATE TABLE IF NOT EXISTS sku_catalog (
  id SERIAL PRIMARY KEY,
  item_number TEXT,
  catalog_number TEXT,
  description TEXT NOT NULL UNIQUE,
  product_type TEXT,
  definition TEXT,
  coverage_value NUMERIC,
  coverage_unit TEXT,
  section_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sku_catalog_full (
  id SERIAL PRIMARY KEY,
  item_number TEXT UNIQUE NOT NULL,
  catalog_number TEXT,
  description TEXT NOT NULL,
  unit TEXT,
  cost NUMERIC,
  price1 NUMERIC,
  price2 NUMERIC,
  price3 NUMERIC,
  price4 NUMERIC,
  product_group TEXT,
  product_section TEXT,
  is_mbf_converted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sku_full_item ON sku_catalog_full(item_number);
CREATE INDEX IF NOT EXISTS idx_sku_full_catalog ON sku_catalog_full(catalog_number);
CREATE INDEX IF NOT EXISTS idx_sku_full_desc ON sku_catalog_full(LOWER(description));

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  quote_number TEXT UNIQUE NOT NULL,
  price_level INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  valid_until DATE,
  subtotal NUMERIC,
  tax_rate NUMERIC NOT NULL DEFAULT 0.13,
  tax_amount NUMERIC,
  total NUMERIC,
  total_cost NUMERIC,
  gross_profit NUMERIC,
  margin_pct NUMERIC,
  margin_adjustment NUMERIC DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  sent_at TIMESTAMPTZ,
  sent_to TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roof_sections (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_name TEXT NOT NULL DEFAULT 'Main Roof',
  corners JSONB NOT NULL DEFAULT '[]'::jsonb,
  pitch TEXT NOT NULL DEFAULT '6:12',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS roof_sections_project_id_idx ON roof_sections(project_id);

CREATE TABLE IF NOT EXISTS roof_section_edges (
  id SERIAL PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES roof_sections(id) ON DELETE CASCADE,
  edge_index INTEGER NOT NULL,
  end_type TEXT NOT NULL DEFAULT 'gable',
  overhang_ft NUMERIC NOT NULL DEFAULT 1.5
);

CREATE INDEX IF NOT EXISTS roof_section_edges_section_id_idx ON roof_section_edges(section_id);

CREATE TABLE IF NOT EXISTS quote_line_items (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  section TEXT,
  category TEXT,
  item_number TEXT,
  catalog_number TEXT,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT,
  unit_cost NUMERIC,
  base_unit_price NUMERIC,
  unit_price NUMERIC,
  line_cost NUMERIC,
  line_price NUMERIC,
  margin_pct NUMERIC,
  price_overridden BOOLEAN DEFAULT false,
  is_package BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_quotes_project ON quotes(project_id);
CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote ON quote_line_items(quote_id);
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
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS rafter_spacing TEXT NOT NULL DEFAULT '24_oc'`,
  // Openings: optional FK to floor_plan_walls (new polygon flow); legacy wall_id stays nullable
  `ALTER TABLE openings ADD COLUMN IF NOT EXISTS floor_plan_wall_id INTEGER REFERENCES floor_plan_walls(id) ON DELETE CASCADE`,
  `ALTER TABLE openings ALTER COLUMN wall_id DROP NOT NULL`,
  // Per-wall flag: does this wall sit directly on concrete? Drives sill gasket selection.
  `ALTER TABLE floor_plan_walls ADD COLUMN IF NOT EXISTS on_concrete BOOLEAN NOT NULL DEFAULT false`,
  // Two-phase drawing: 'exterior' until polygon closes, then 'interior'.
  `ALTER TABLE floor_plans ADD COLUMN IF NOT EXISTS drawing_phase TEXT NOT NULL DEFAULT 'exterior'`,
  // Customer FK (legacy free-text projects.customer column stays as fallback).
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`,
  // PDF underlay metadata.
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS pdf_filename TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS pdf_scale NUMERIC`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS pdf_page INTEGER NOT NULL DEFAULT 1`,
  // Display-only label for interior walls (e.g. "2x6 Interior Load Bearing").
  // The actual wall_type stays as 'interior_2x4'/'interior_2x6' so the rules engine is untouched.
  `ALTER TABLE floor_plan_interior_walls ADD COLUMN IF NOT EXISTS interior_wall_type_label TEXT`,
  // Auto-calculated floor area from polygon (cached) + ceiling drywall sheet selector.
  `ALTER TABLE floors ADD COLUMN IF NOT EXISTS auto_floor_area_sf NUMERIC`,
  `ALTER TABLE floor_plans ADD COLUMN IF NOT EXISTS auto_floor_area_sf NUMERIC`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS ceiling_drywall_type TEXT NOT NULL DEFAULT '41212dw'`,
  // User role for admin-only gates.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'`,
  // Track which user created each project (NULL for projects predating this column).
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by TEXT`,
  // Pricing fields on the curated SKU catalog (synced from sku_catalog_full by import script).
  `ALTER TABLE sku_catalog ADD COLUMN IF NOT EXISTS cost NUMERIC`,
  `ALTER TABLE sku_catalog ADD COLUMN IF NOT EXISTS price1 NUMERIC`,
  `ALTER TABLE sku_catalog ADD COLUMN IF NOT EXISTS price2 NUMERIC`,
  `ALTER TABLE sku_catalog ADD COLUMN IF NOT EXISTS price3 NUMERIC`,
  `ALTER TABLE sku_catalog ADD COLUMN IF NOT EXISTS price4 NUMERIC`,
  // Project-level price tier for quote generation (1=Retail, 2=Builder, 3=Large Builder, 4=Top Volume).
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS price_level INTEGER NOT NULL DEFAULT 1`,
  // Marks rows whose stored cost/price values have already been converted from
  // MBF (price per thousand board feet) to per-piece. Importers that do the
  // conversion set this true; lookup code only runs the on-the-fly MBF math
  // when this is false (covers legacy rows from before the import re-run).
  `ALTER TABLE sku_catalog_full ADD COLUMN IF NOT EXISTS is_mbf_converted BOOLEAN DEFAULT false`,
  // Warehouse-canonical description, mirrored from sku_catalog_full by
  // item/catalog match. sku_catalog.description stays the wall-rules match
  // key (so the rules engine output continues to join correctly); this
  // field is what customer-facing surfaces (quotes, PDFs, material list
  // table) display.
  `ALTER TABLE sku_catalog ADD COLUMN IF NOT EXISTS warehouse_description TEXT`,
  // Manual cost/price overrides on packages (truss, floor, etc.). NULL = unpriced
  // → quote line falls back to "— Quoted Separately —". When set, the package
  // hits subtotal/HST/totals/margin like any other line item.
  `ALTER TABLE packages ADD COLUMN IF NOT EXISTS cost NUMERIC`,
  `ALTER TABLE packages ADD COLUMN IF NOT EXISTS price1 NUMERIC`,
  `ALTER TABLE packages ADD COLUMN IF NOT EXISTS price2 NUMERIC`,
  `ALTER TABLE packages ADD COLUMN IF NOT EXISTS price3 NUMERIC`,
  `ALTER TABLE packages ADD COLUMN IF NOT EXISTS price4 NUMERIC`,
  // Interior doors. swing = LHI/LHO/RHI/RHO (reference/labelling only — does not
  // affect material quantities). floor_plan_interior_wall_id lets an opening
  // attach to a floor_plan_interior_walls row instead of a polygon edge or
  // legacy wall.
  `ALTER TABLE openings ADD COLUMN IF NOT EXISTS swing TEXT DEFAULT 'RHI'`,
  `ALTER TABLE openings ADD COLUMN IF NOT EXISTS floor_plan_interior_wall_id INTEGER REFERENCES floor_plan_interior_walls(id) ON DELETE CASCADE`,
  // Per-section ridge direction override. 'auto' (default) picks the long
  // axis of the bounding box; 'horizontal' / 'vertical' force the ridge.
  `ALTER TABLE roof_sections ADD COLUMN IF NOT EXISTS ridge_direction TEXT DEFAULT 'auto'`,
];

const SKU_CATALOG_SEED = [
  // SPRUCE LUMBER
  { item: '1051117', catalog: '2416P',     desc: '2 X 4 X 16 PREMIUM SPRUCE',          definition: 'Spruce Lumber', section_notes: 'Default interior wall bottom and top plates' },
  { item: '1051115', catalog: '2414P',     desc: '2 X 4 X 14 PREMIUM SPRUCE',          definition: 'Spruce Lumber' },
  { item: '1051113', catalog: '2412P',     desc: '2 X 4 X 12 PREMIUM SPRUCE',          definition: 'Spruce Lumber' },
  { item: '1051111', catalog: '2410P',     desc: '2 X 4 X 10 PREMIUM SPRUCE',          definition: 'Spruce Lumber' },
  { item: '1051109', catalog: '2408P',     desc: '2 X 4 X 8 PREMIUM SPRUCE',           definition: 'Spruce Lumber' },
  { item: '1011118', catalog: '249258P',   desc: '2 X 4 X 92-5/8 PREMIUM SPRUCE',      definition: 'Spruce Lumber', section_notes: 'Default interior wall studs for 8ft walls' },
  { item: '1011122', catalog: '2410458P',  desc: '2 X 4 X 104-5/8 PREMIUM SPRUCE',     definition: 'Spruce Lumber' },
  { item: '1052117', catalog: '2616P',     desc: '2 X 6 X 16 PREMIUM SPRUCE',          definition: 'Spruce Lumber', section_notes: 'Default 2x6 wall plates' },
  { item: '1052115', catalog: '2614P',     desc: '2 X 6 X 14 PREMIUM SPRUCE',          definition: 'Spruce Lumber' },
  { item: '1052113', catalog: '2612P',     desc: '2 X 6 X 12 PREMIUM SPRUCE',          definition: 'Spruce Lumber' },
  { item: '1052111', catalog: '2610P',     desc: '2 X 6 X 10 PREMIUM SPRUCE',          definition: 'Spruce Lumber' },
  { item: '1052109', catalog: '2608P',     desc: '2 X 6 X 8 PREMIUM SPRUCE',           definition: 'Spruce Lumber' },
  { item: '1011181', catalog: '269258P',   desc: '2 X 6 X 92-5/8 PREMIUM SPRUCE',      definition: 'Spruce Lumber' },
  { item: '1011242', catalog: '2610458P',  desc: '2 X 6 X 104-5/8 PREMIUM SPRUCE',     definition: 'Spruce Lumber' },
  { item: '1058116', catalog: '1416SP',    desc: '1 X 4 - 16 SPRUCE STRAPPING',        definition: 'Spruce Lumber' },

  // PLYWOOD AND SHEATHING
  { item: '2021110', catalog: '716OSB',    desc: '4 X 8 - 7/16 ORIENTED STRAND BOARD', definition: 'Plywood Sheathing', coverage_value: 32, coverage_unit: 'sq ft', section_notes: 'Default exterior wall sheathing' },
  { item: '2031110', catalog: '12CSP',     desc: '4 X 8 - 1/2 STD.SPRUCE PLYWOOD',     definition: 'Plywood Sheathing', coverage_value: 32, coverage_unit: 'sq ft', section_notes: 'Roof sheathing default' },
  { item: '2031125', catalog: '58TGCSP',   desc: '4 X 8 - 5/8 T&G STD.SPRUCE PLY',     definition: 'Plywood Sheathing', coverage_value: 32, coverage_unit: 'sq ft', section_notes: 'Subfloor for floors' },
  { item: '2021120', catalog: '34TGCSP',   desc: '4 X 8 - 3/4 T&G STD.SPRUCE PLY',     definition: 'Plywood Sheathing', coverage_value: 32, coverage_unit: 'sq ft', section_notes: 'Subfloor for floors' },
  { item: '2031115', catalog: '58CSP',     desc: '4 X 8 - 5/8 STD.SPRUCE PLYWOOD',     definition: 'Plywood Sheathing', coverage_value: 32, coverage_unit: 'sq ft' },
  { item: '2031120', catalog: '34CSP',     desc: '4 X 8 - 3/4 STD.SPRUCE PLYWOOD',     definition: 'Plywood Sheathing', coverage_value: 32, coverage_unit: 'sq ft' },

  // SILL GASKET
  { item: '90640139', catalog: '2611212', desc: 'GASKET,SILL 3/16 WHITE 3.5X82', definition: 'Sill Gasket', section_notes: 'Under bottom plates for 2x4 wall' },
  { item: '90640140', catalog: '2611221', desc: 'GASKET,SILL 3/16 WHITE 5.5X82', definition: 'Sill Gasket', section_notes: 'Under bottom plates for 2x6 wall' },
  { item: '90640972', catalog: '2611222', desc: 'GASKET,SILL 3/16 WHITE 7.5X82', definition: 'Sill Gasket', section_notes: 'Under bottom plates for 2x8 wall' },

  // SHEATHING TAPE
  { item: '90641001', catalog: '2611202', desc: 'TAPE,SHEATHING PLY RED 60MMX55M',  definition: 'Sheathing Tape', coverage_value: 55,  coverage_unit: 'meters', section_notes: 'Default — tapes exterior insulation at seams' },
  { item: '90641002', catalog: '2611203', desc: 'TAPE,SHEATHING PLY 60MMX55M 4PK',  definition: 'Sheathing Tape', coverage_value: 220, coverage_unit: 'meters' },
  { item: '90640907', catalog: '2611261', desc: 'TAPE,SHEATHING PLY BLUE 60MMX55M', definition: 'Sheathing Tape', coverage_value: 55,  coverage_unit: 'meters' },

  // SILVERBOARD EXTERIOR INSULATION (catalog numbers fixed up post-seed)
  { item: null, catalog: '1SB',   desc: 'SILVERBOARD GRAPHITE 4X8 1" R5',    definition: 'Exterior Rigid Insulation', coverage_value: 32, coverage_unit: 'sq ft' },
  { item: null, catalog: '112SB', desc: 'SILVERBOARD GRAPHITE 4X8 1.5" R7.5', definition: 'Exterior Rigid Insulation', coverage_value: 32, coverage_unit: 'sq ft' },
  { item: null, catalog: '2SB',   desc: 'SILVERBOARD GRAPHITE 4X8 2" R10',   definition: 'Exterior Rigid Insulation', coverage_value: 32, coverage_unit: 'sq ft' },

  // WALL INSULATION — PINK FIBREGLASS
  { item: '5120681', catalog: 'R2215', desc: 'R22-15 FIBREGLASS INSUL. 49.0 SQ FT',  definition: 'Wall Insulation Pink', coverage_value: 49,    coverage_unit: 'sq ft' },
  { item: '5120680', catalog: 'R2223', desc: 'R22-23 FIBREGLASS INSUL 75.1 SQ FT',   definition: 'Wall Insulation Pink', coverage_value: 75.1,  coverage_unit: 'sq ft' },
  { item: '5120110', catalog: 'R1215', desc: 'R12-15 FIBREGLASS INSUL. 97.9 SQ FT',  definition: 'Wall Insulation Pink', coverage_value: 97.9,  coverage_unit: 'sq ft' },
  { item: '5120130', catalog: 'R1223', desc: 'R12-23 FIBREGLASS INSUL. 150.1 SQ FT', definition: 'Wall Insulation Pink', coverage_value: 150.1, coverage_unit: 'sq ft' },
  { item: '5120140', catalog: 'R1415', desc: 'R14-15 FIBREGLASS INSUL. 78.3 SQ FT',  definition: 'Wall Insulation Pink', coverage_value: 78.3,  coverage_unit: 'sq ft' },
  { item: '5120141', catalog: 'R1423', desc: 'R14-23 FIBREGLASS INSUL. 120.1 SQ FT', definition: 'Wall Insulation Pink', coverage_value: 120.1, coverage_unit: 'sq ft' },
  { item: '5120161', catalog: 'R2415', desc: 'R24-15 FIBREGLASS INSUL 33.7 SQ FT',   definition: 'Wall Insulation Pink', coverage_value: 33.7,  coverage_unit: 'sq ft' },
  { item: '5120162', catalog: 'R2424', desc: 'R24-24 FIBREGLASS INSUL 52 SQ FT',     definition: 'Wall Insulation Pink', coverage_value: 52,    coverage_unit: 'sq ft' },
  { item: '5120190', catalog: 'R3116', desc: 'R31-16 FIBREGLASS INSUL. 42 SQ FT',    definition: 'Wall Insulation Pink', coverage_value: 42,    coverage_unit: 'sq ft' },
  { item: '5120200', catalog: 'R3124', desc: 'R31-24 FIBREGLASS INSUL. 64 SQ FT',    definition: 'Wall Insulation Pink', coverage_value: 64,    coverage_unit: 'sq ft' },
  { item: '5120210', catalog: 'R4016', desc: 'R40 X 16 FIBREGLASS INSUL. 32 SQ FT',  definition: 'Wall Insulation Pink', coverage_value: 32,    coverage_unit: 'sq ft' },

  // WALL INSULATION — ROCKWOOL
  { item: '5120430', catalog: 'ROX1415', desc: 'ROCKWOOL R14X15-1/4 59.7 SQFT',          definition: 'Wall Insulation Rockwool', coverage_value: 59.7, coverage_unit: 'sq ft' },
  { item: '5120440', catalog: 'ROX1323', desc: 'ROCKWOOL R14X24 60.1 SQFT',              definition: 'Wall Insulation Rockwool', coverage_value: 60.1, coverage_unit: 'sq ft' },
  { item: '5120450', catalog: 'ROX2215', desc: 'ROCKWOOL R22X15-1/4 39.8 SQFT',          definition: 'Wall Insulation Rockwool', coverage_value: 39.8, coverage_unit: 'sq ft' },
  { item: '5120460', catalog: 'ROX2123', desc: 'ROCKWOOL R22X23 37.5 SQFT',              definition: 'Wall Insulation Rockwool', coverage_value: 37.5, coverage_unit: 'sq ft' },
  { item: '5120470', catalog: 'ROX315',  desc: 'ROCKWOOL SAFE-N-SOUND 3X15 59.7 SQFT',   definition: 'Wall Insulation Rockwool', coverage_value: 59.7, coverage_unit: 'sq ft' },
  { item: '5120471', catalog: 'ROX615',  desc: 'ROCKWOOL SAFE-N-SOUND 6X15 29 SQFT',     definition: 'Wall Insulation Rockwool', coverage_value: 29,   coverage_unit: 'sq ft' },

  // VAPOUR BARRIER
  { item: '5120413', catalog: '86POLY',       desc: 'VAPOUR BARRIER 6M X1500 8\'6"', definition: 'Vapour Barrier', coverage_value: 1500, coverage_unit: 'sq ft', section_notes: 'Default wall poly over insulation' },
  { item: '5120410', catalog: '6MIL1500/10',  desc: "VAPOUR BARRIER 6M X1500 10'",   definition: 'Vapour Barrier', coverage_value: 1500, coverage_unit: 'sq ft' },
  { item: '5120380', catalog: '6MIL500',      desc: 'VAPOUR BARRIER 6M X 500 SQ FT', definition: 'Vapour Barrier', coverage_value: 500,  coverage_unit: 'sq ft' },
  { item: '5120412', catalog: '6MILL2000FT',  desc: 'VAPOUR BARRIER 6M X 2000 20FT', definition: 'Vapour Barrier', coverage_value: 2000, coverage_unit: 'sq ft' },
  { item: '5120414', catalog: '106POLY',      desc: 'VAPOUR BARRIER 10\'4 X 1000 SQFT', definition: 'Vapour Barrier', coverage_value: 1000, coverage_unit: 'sq ft' },

  // SUBFLOOR ADHESIVE
  { item: '28012002', catalog: '2030590', desc: 'ADHSV,CNSTR PL PREM PNT825ML', definition: 'Subfloor Adhesive', coverage_value: 500, coverage_unit: 'sq ft', section_notes: 'Include in floor section with subfloor' },

  // ROOF SHINGLES — IKO CAMBRIDGE
  { item: '7011249', catalog: 'DUALBLACK',     desc: 'IKO CAMBRIDGE DUAL BLACK 33SF',    definition: 'Roof Shingles', coverage_value: 33, coverage_unit: 'sq ft' },
  { item: '7011251', catalog: 'DUALBROWN',     desc: 'IKO CAMBRIDGE DUAL BROWN 33SF',    definition: 'Roof Shingles', coverage_value: 33, coverage_unit: 'sq ft' },
  { item: '7011261', catalog: 'DUALGREY',      desc: 'IKO CAMBRIDGE DUAL GREY 33SF',     definition: 'Roof Shingles', coverage_value: 33, coverage_unit: 'sq ft' },
  { item: '7011263', catalog: 'CHARCOALGREY',  desc: 'IKO CAMBRIDGE CHARCOAL GRY 33SF',  definition: 'Roof Shingles', coverage_value: 33, coverage_unit: 'sq ft' },
  { item: '7011255', catalog: 'DRIFTWOOD',     desc: 'IKO CAMBRIDGE DRIFTWOOD 33SF',     definition: 'Roof Shingles', coverage_value: 33, coverage_unit: 'sq ft' },
  { item: '7011259', catalog: 'HARVARDSLATE',  desc: 'IKO CAMBRIDGE HARVARDSLATE 33SF',  definition: 'Roof Shingles', coverage_value: 33, coverage_unit: 'sq ft' },
  { item: '7011257', catalog: 'WEATHERWOOD',   desc: 'IKO CAMBRIDGE WEATHERWOOD 33SF',   definition: 'Roof Shingles', coverage_value: 33, coverage_unit: 'sq ft' },

  // HIP AND RIDGE
  { item: '7011250', catalog: 'HRDUALBLACK',     desc: 'IKO HIP&RIDGE DUAL BLACK 36.5LF',     definition: 'Hip Ridge', coverage_value: 36.5, coverage_unit: 'linear ft' },
  { item: '7011252', catalog: 'HRDUALBROWN',     desc: 'IKO HIP&RIDGE DUAL BROWN 36.5LF',     definition: 'Hip Ridge', coverage_value: 36.5, coverage_unit: 'linear ft' },
  { item: '7011262', catalog: 'HRDUALGREY',      desc: 'IKO HIP&RIDGE DUAL GREY 36.5LF',      definition: 'Hip Ridge', coverage_value: 36.5, coverage_unit: 'linear ft' },
  { item: '7011264', catalog: 'HRCHARCOALGREY',  desc: 'IKO HIP&RIDGE CHARCOAL GRY 36.5LF',   definition: 'Hip Ridge', coverage_value: 36.5, coverage_unit: 'linear ft' },
  { item: '7011256', catalog: 'HRDRIFTWOOD',     desc: 'IKO HIP&RIDGE DRIFTWOOD 36.5LF',      definition: 'Hip Ridge', coverage_value: 36.5, coverage_unit: 'linear ft' },
  { item: '7011258', catalog: 'HRWEATHERWOOD',   desc: 'IKO HIP&RIDGE WEATHERWOOD 36.5LF',    definition: 'Hip Ridge', coverage_value: 36.5, coverage_unit: 'linear ft' },
  { item: '7011260', catalog: 'HRHARVARDSLATE',  desc: 'IKO HIP&RIDGE HARVARDSLATE 36.5LF',   definition: 'Hip Ridge', coverage_value: 36.5, coverage_unit: 'linear ft' },
  { item: '7011254', catalog: 'HREARTONECEDAR',  desc: 'IKO HIP&RIDGE EARTONE CED 36.5LF',    definition: 'Hip Ridge', coverage_value: 36.5, coverage_unit: 'linear ft' },

  // ROOF ACCESSORIES
  { item: '7011266', catalog: 'LEADINGEDGE', desc: 'IKO STARTER LEADINGEDGE 123LF',   definition: 'Roof Accessories', coverage_value: 123,  coverage_unit: 'linear ft', section_notes: 'Along eaves and rake edges' },
  { item: '7011268', catalog: 'STORMSHIELD', desc: 'IKO STORMSHIELD ICE&WATER 195SF', definition: 'Roof Accessories', coverage_value: 195,  coverage_unit: 'sq ft', section_notes: '3ft roll, along eaves and rakes' },
  { item: '7011265', catalog: 'STORMTITE',   desc: 'IKO STORMTITE 1000SF UNDERLAY',   definition: 'Roof Accessories', coverage_value: 1000, coverage_unit: 'sq ft', section_notes: 'Underlay for whole roof' },

  // SOFFIT
  { item: '3010770', catalog: '061091', desc: 'ALUM. 2 PANEL VENTED SOFFIT WHITE',  definition: 'Soffit Aluminum', coverage_value: 16, coverage_unit: 'sq ft', section_notes: '12 linear ft x 16in width per piece' },
  { item: '3010781', catalog: '060515', desc: 'ALUM SOFFIT 3 PAN/BLK LOW GLOSS',    definition: 'Soffit Aluminum', coverage_value: 16, coverage_unit: 'sq ft' },

  // FASCIA
  { item: '3010850', catalog: '048091', desc: '6" ALUMINUM FASCIA WHITE 10\'',  definition: 'Fascia Aluminum', coverage_value: 10, coverage_unit: 'linear ft' },
  { item: '3010862', catalog: 'FLG',    desc: '6" ALUMINUM FASCIA BLACK 10\'',  definition: 'Fascia Aluminum', coverage_value: 10, coverage_unit: 'linear ft' },
  { item: '3010870', catalog: '048191', desc: '8" ALUMINUM FASCIA WHITE 10\'',  definition: 'Fascia Aluminum', coverage_value: 10, coverage_unit: 'linear ft' },
  { item: '3010880', catalog: '1698BR', desc: '8" ALUMINUM FASCIA BROWN 10\'',  definition: 'Fascia Aluminum', coverage_value: 10, coverage_unit: 'linear ft' },
  { item: '3010860', catalog: '1696BR', desc: '6" ALUMINUM FASCIA BROWN 10\'',  definition: 'Fascia Aluminum', coverage_value: 10, coverage_unit: 'linear ft' },
  { item: '3010830', catalog: '049591', desc: '4" ALUMINUM FASCIA WHITE 10\'',  definition: 'Fascia Aluminum', coverage_value: 10, coverage_unit: 'linear ft' },

  // FOUNDATION INSULATION
  { item: '5120600', catalog: '1CF',   desc: '1" CELFORT 2X8 24/BDL R5',     definition: 'Foundation Insulation', coverage_value: 16, coverage_unit: 'sq ft', section_notes: 'Under foundation slab' },
  { item: '5120610', catalog: '112CF', desc: '1 1/2" CELFORT 2X8 16/BDL R7.5', definition: 'Foundation Insulation', coverage_value: 16, coverage_unit: 'sq ft' },
  { item: '5120620', catalog: '2CF',   desc: '2" CELFORT 2X8 12/BDL R10',    definition: 'Foundation Insulation', coverage_value: 16, coverage_unit: 'sq ft' },

  // DRYWALL (height-specific wall sheets + ceiling sheets + firecode)
  { item: null, catalog: '4812DW',   desc: '4 X 8 - 1/2" DRYWALL',           definition: 'Drywall', coverage_value: 32, coverage_unit: 'sq ft', section_notes: 'Wall drywall for 8ft walls' },
  { item: null, catalog: '49DRY',    desc: '4 X 9 - 1/2" DRYWALL',           definition: 'Drywall', coverage_value: 36, coverage_unit: 'sq ft', section_notes: 'Wall drywall for 9ft walls' },
  { item: null, catalog: '41012DW',  desc: '4 X 10 - 1/2" DRYWALL',          definition: 'Drywall', coverage_value: 40, coverage_unit: 'sq ft', section_notes: 'Wall drywall for 10ft walls' },
  { item: null, catalog: '41212DW',  desc: '4 X 12 - 1/2" DRYWALL',          definition: 'Drywall', coverage_value: 48, coverage_unit: 'sq ft', section_notes: 'Ceiling drywall default' },
  { item: null, catalog: '4858FCDW', desc: '4 X 8 - 5/8" FIRECODE DRYWALL',  definition: 'Drywall Firecode', coverage_value: 32, coverage_unit: 'sq ft', section_notes: 'Firecode drywall' },

  // TYPAR + FLASHING
  { item: null, catalog: 'TYPAR',     desc: "9'X100' TYPAR HOUSEWRAP",        definition: 'Housewrap', coverage_value: 900, coverage_unit: 'sq ft', section_notes: 'Exterior wall wrap' },
  { item: null, catalog: 'TYPAR36',   desc: '36"X100\' TYPAR HEADERWRAP',     definition: 'Housewrap', coverage_value: 100, coverage_unit: 'linear ft', section_notes: 'Floor joist perimeter wrap' },
  { item: null, catalog: 'TYPAR9X75', desc: 'TYPAR FLASHING 9"X75\'',          definition: 'Flashing Typar', coverage_value: 75, coverage_unit: 'linear ft', section_notes: 'Around openings' },
  { item: null, catalog: 'TYPAR4X75', desc: 'TYPAR FLASHING 4"X75\'',          definition: 'Flashing Typar', coverage_value: 75, coverage_unit: 'linear ft' },
  { item: null, catalog: 'TYPAR6X75', desc: 'TYPAR FLASHING 6"X75\'',          definition: 'Flashing Typar', coverage_value: 75, coverage_unit: 'linear ft' },
  { item: null, catalog: 'TYPAR12X75',desc: 'TYPAR FLASHING 12"X75\'',         definition: 'Flashing Typar', coverage_value: 75, coverage_unit: 'linear ft' },

  // BELOW GRADE
  { item: null, catalog: 'SB35', desc: 'SB-35PSI R10 BELOW GR. 2"X4\'X8\'', definition: 'Foundation Insulation', coverage_value: 32, coverage_unit: 'sq ft', section_notes: 'Below grade foundation insulation, alternative to Celfort' },

  // SUBFLOOR OSB ALTERNATIVES
  { item: null, catalog: '58TGOSB', desc: '4 X 8 - 5/8 T&G ORIENTED ST.BOARD', definition: 'Plywood Sheathing', coverage_value: 32, coverage_unit: 'sq ft', section_notes: 'Subfloor alternative to T&G plywood' },
  { item: null, catalog: '34TGOSB', desc: '4 X 8 - 3/4 T&G ORIENTED ST.BOARD', definition: 'Plywood Sheathing', coverage_value: 32, coverage_unit: 'sq ft', section_notes: 'Subfloor alternative to T&G plywood' },

  // CLEAR POLY
  { item: null, catalog: '2645840', desc: '12 X 300FT CLEAR POLY', definition: 'Plate Poly', coverage_value: 300, coverage_unit: 'linear ft', section_notes: 'Plate poly for interior walls' },
];

// Catalog-number fixups for previously-seeded SKUs that were inserted with null catalog.
const SKU_CATALOG_FIXUPS = [
  ["SILVERBOARD GRAPHITE 4X8 1\" R5",     '1SB'],
  ["SILVERBOARD GRAPHITE 4X8 1.5\" R7.5", '112SB'],
  ["SILVERBOARD GRAPHITE 4X8 2\" R10",    '2SB'],
];

// Item-number fixups for SKUs originally seeded with null item_number.
// Looked up from the warehouse catalog after the fact. Pairs of [catalog_number, item_number].
// Silverboard 1"/1.5"/2" and CLARYPOLY are still pending — left null until item numbers are known.
const SKU_CATALOG_ITEM_NUMBER_FIXUPS = [
  ['112SB',      '5120002'],
  ['2SB',        '5120003'],
  ['4812DW',     '6010410'],
  ['49DRY',      '6010421'],
  ['41012DW',    '6010420'],
  ['41212DW',    '6010430'],
  ['4858FCDW',   '6010450'],
  ['TYPAR',      '26010001'],
  ['TYPAR36',    '26010002'],
  ['TYPAR9X75',  '26010006'],
  ['TYPAR4X75',  '26010005'],
  ['TYPAR6X75',  '26010010'],
  ['TYPAR12X75', '26010009'],
  ['SB35',       '5120004'],
  ['58TGOSB',    '2021115'],
  ['34TGOSB',    '2021116'],
];

const SYSTEM_SETTINGS_DEFAULTS = [
  // Wall defaults
  ['default_exterior_stud_type', 'exterior_2x6'],
  ['default_interior_stud_type', 'interior_2x4'],
  ['default_stud_spacing', '16'],
  ['default_wall_height_floor1', '9'],
  ['default_wall_height_floor2', '9'],
  ['default_corner_style', '3_stud'],
  // Sheathing / wrap
  ['default_wall_sheathing', '7/16_osb'],
  ['default_roof_sheathing', '1/2_csp'],
  ['default_rafter_spacing', '24_oc'],
  ['default_silverboard', 'silverboard_1'],
  // Insulation / drywall
  ['default_wall_insulation', 'pink_r22_15'],
  ['default_ceiling_drywall', '41212dw'],
  // Waste factors (decimal, e.g. 0.05 = 5%)
  ['waste_lumber',     '0.05'],
  ['waste_sheet',      '0.10'],
  ['waste_roof_sheet', '0.10'],
  ['waste_concrete',   '0.05'],
  ['waste_housewrap',  '0.10'],
  ['waste_insulation', '0.00'],
];

async function seedSkuCatalog() {
  for (const s of SKU_CATALOG_SEED) {
    await pool.query(
      `INSERT INTO sku_catalog
         (item_number, catalog_number, description, definition, coverage_value, coverage_unit, section_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (description) DO NOTHING`,
      [
        s.item ?? null,
        s.catalog ?? null,
        s.desc,
        s.definition ?? null,
        s.coverage_value ?? null,
        s.coverage_unit ?? null,
        s.section_notes ?? null,
      ]
    );
  }
  // Apply catalog-number fixups for rows seeded earlier without catalogs.
  for (const [desc, catalog] of SKU_CATALOG_FIXUPS) {
    await pool.query(
      `UPDATE sku_catalog SET catalog_number = $1
       WHERE description = $2 AND (catalog_number IS NULL OR catalog_number <> $1)`,
      [catalog, desc]
    );
  }
  // Apply item-number fixups for rows seeded with null item_number.
  for (const [catalog, item] of SKU_CATALOG_ITEM_NUMBER_FIXUPS) {
    await pool.query(
      `UPDATE sku_catalog SET item_number = $1
       WHERE catalog_number = $2 AND (item_number IS NULL OR item_number = '')`,
      [item, catalog]
    );
  }
  // Description-based pricing sync for any sku_catalog row still missing
  // an item_number — finds the matching row in sku_catalog_full by exact
  // description (case-insensitive, trimmed) and pulls in cost + prices +
  // item_number. Runs only after sku_catalog_full has been populated by
  // the import script; harmless if that table is empty.
  await pool.query(`
    UPDATE sku_catalog sc
    SET
      cost   = scf.cost,
      price1 = scf.price1,
      price2 = scf.price2,
      price3 = scf.price3,
      price4 = scf.price4,
      item_number = scf.item_number,
      catalog_number = COALESCE(sc.catalog_number, scf.catalog_number)
    FROM sku_catalog_full scf
    WHERE sc.item_number IS NULL
      AND LOWER(TRIM(sc.description)) = LOWER(TRIM(scf.description))
      AND (scf.cost IS NOT NULL OR scf.price1 IS NOT NULL)
  `);
  // Clear-poly fixup: the legacy catalog 'CLARYPOLY' isn't in the warehouse
  // catalog. The real SKU is catalog 2645840 ("FILM,12" CGSB SF CLR 300SF",
  // item 2225). Reset the row to the new catalog and pull cost+prices+item
  // from sku_catalog_full by catalog match (description differs, so the
  // description-based sync above won't catch it).
  await pool.query(`
    UPDATE sku_catalog
    SET catalog_number = '2645840', item_number = NULL
    WHERE description = '12 X 300FT CLEAR POLY'
  `);
  await pool.query(`
    UPDATE sku_catalog sc
    SET
      cost   = scf.cost,
      price1 = scf.price1,
      price2 = scf.price2,
      price3 = scf.price3,
      price4 = scf.price4,
      item_number = scf.item_number
    FROM sku_catalog_full scf
    WHERE sc.catalog_number = '2645840'
      AND scf.catalog_number = '2645840'
  `);
  // Mirror warehouse-canonical descriptions onto sku_catalog so customer-
  // facing surfaces can display them. Match by item_number first (most
  // specific), then by catalog_number for rows that don't have an item.
  // sku_catalog.description is left alone — it remains the wall-rules
  // match key and must not change without also updating wallRules output.
  await pool.query(`
    UPDATE sku_catalog sc
    SET warehouse_description = scf.description
    FROM sku_catalog_full scf
    WHERE sc.item_number IS NOT NULL
      AND sc.item_number = scf.item_number
  `);
  await pool.query(`
    UPDATE sku_catalog sc
    SET warehouse_description = scf.description
    FROM sku_catalog_full scf
    WHERE sc.warehouse_description IS NULL
      AND sc.catalog_number IS NOT NULL
      AND sc.catalog_number = scf.catalog_number
  `);

  // Catalog-pinned fixups: roof plywood (12CSP), hurricane ties (2682200),
  // and H-clips (2110673). For these the wall-rules name string and the
  // warehouse description differ enough that description-match misses;
  // and 2682200 + 2110673 weren't seeded in sku_catalog at all. INSERT
  // from sku_catalog_full by catalog and on description-conflict update
  // every field — this both creates missing rows and resyncs existing
  // ones. wallRules.js uses the warehouse descriptions for these three
  // so the rules-engine → sku_catalog match still resolves.
  const pinnedSync = await pool.query(`
    INSERT INTO sku_catalog
      (item_number, catalog_number, description, warehouse_description,
       cost, price1, price2, price3, price4)
    SELECT scf.item_number, scf.catalog_number, scf.description, scf.description,
           scf.cost, scf.price1, scf.price2, scf.price3, scf.price4
    FROM sku_catalog_full scf
    WHERE scf.catalog_number IN ('12CSP', '2682200', '2110673')
    ON CONFLICT (description) DO UPDATE SET
      item_number = EXCLUDED.item_number,
      catalog_number = EXCLUDED.catalog_number,
      warehouse_description = EXCLUDED.warehouse_description,
      cost = EXCLUDED.cost,
      price1 = EXCLUDED.price1,
      price2 = EXCLUDED.price2,
      price3 = EXCLUDED.price3,
      price4 = EXCLUDED.price4
  `);
  if (pinnedSync.rowCount > 0) {
    console.log(`Catalog-pinned sync: upserted ${pinnedSync.rowCount} sku_catalog rows (12CSP / 2682200 / 2110673)`);
  }

  // Cleanup: any sku_catalog row whose item_number is set but doesn't exist
  // in sku_catalog_full was a guess that didn't match the warehouse. Log
  // them then delete. NULL-item rows are left alone — those are manually
  // curated entries (Silverboard, etc.) not yet matched to the warehouse.
  const orphans = (await pool.query(`
    SELECT item_number, catalog_number, description
    FROM sku_catalog
    WHERE item_number IS NOT NULL
      AND item_number <> ''
      AND item_number NOT IN (SELECT item_number FROM sku_catalog_full WHERE item_number IS NOT NULL)
    ORDER BY description
  `)).rows;
  if (orphans.length > 0) {
    console.log(`Removing ${orphans.length} sku_catalog rows whose item_number isn't in sku_catalog_full:`);
    for (const r of orphans) {
      console.log(`  ${r.item_number}  ${r.catalog_number}  ${r.description}`);
    }
    await pool.query(`
      DELETE FROM sku_catalog
      WHERE item_number IS NOT NULL
        AND item_number <> ''
        AND item_number NOT IN (SELECT item_number FROM sku_catalog_full WHERE item_number IS NOT NULL)
    `);
  } else {
    console.log('No orphan sku_catalog rows to clean up.');
  }
}

async function seedSystemSettings() {
  for (const [key, value] of SYSTEM_SETTINGS_DEFAULTS) {
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }
}

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

async function ensureExtraUsers() {
  const extras = [
    { username: 'OB', password: 'changeme' },
    { username: 'SR', password: 'changeme' },
  ];
  for (const { username, password } of extras) {
    const existing = await pool.query('SELECT id FROM users WHERE username=$1', [username]);
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hash]);
      console.log(`Seeded user: ${username} / ${password}`);
    }
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
    await ensureExtraUsers();
    await seedExamples();
    await seedSkuCatalog();
    console.log('SKU catalog seeded.');
    await seedSystemSettings();
    console.log('System settings seeded.');
    console.log('Migration done.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
