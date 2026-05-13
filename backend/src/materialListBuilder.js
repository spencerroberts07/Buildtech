import { query } from './db.js';
import {
  computeWallMaterials,
  computeProjectMaterials,
  computeRoofMaterials,
  buildFloorPlanWalls,
  sumMaterials,
  resolveProjectSettings,
  sectionFor,
  sectionRank,
  categoryRank,
  LEVELS,
} from './wallRules.js';
import { ensureMaterial } from './materialUpsert.js';

// Compute the full material list for a project. Mirrors the GET /:id/material-list
// behavior so the quote builder can reuse it. Returns the same row shape the route
// emits.
//
// options:
//   includeDeleted: include rows that are tombstoned via material_deletions, with
//     deleted:true on each. Default false (deleted rows are dropped).
export async function computeProjectMaterialList(projectId, options = {}) {
  const { includeDeleted = false } = options;
  const id = projectId;

  // Existing measurement-based rollup (unchanged SQL)
  const measurementRollup = await query(`
    SELECT
      m.id AS material_id,
      m.name AS material_name,
      m.unit AS material_unit,
      SUM(meas.quantity * ai.quantity_per_unit * (1 + ai.waste_factor)) AS total_quantity
    FROM measurements meas
    JOIN assemblies a ON a.id = meas.assembly_id
    JOIN assembly_items ai ON ai.assembly_id = a.id
    JOIN materials m ON m.id = ai.material_id
    WHERE meas.project_id = $1
    GROUP BY m.id, m.name, m.unit
  `, [id]);

  // Wall-based rollup
  const projectRow = (await query('SELECT * FROM projects WHERE id = $1', [id])).rows[0];
  if (!projectRow) return null;
  const globalRow = (await query('SELECT * FROM settings WHERE id = 1')).rows[0];
  const walls = (await query('SELECT * FROM walls WHERE project_id = $1', [id])).rows;

  // Load system_settings (waste factors + global defaults) once.
  const sysRows = (await query('SELECT key, value FROM system_settings')).rows;
  const sys = Object.fromEntries(sysRows.map((r) => [r.key, r.value]));
  const wasteFactors = {
    lumber:     parseFloat(sys.waste_lumber)     || 0.05,
    sheet:      parseFloat(sys.waste_sheet)      || 0.10,
    roofSheet:  parseFloat(sys.waste_roof_sheet) || 0.10,
    concrete:   parseFloat(sys.waste_concrete)   || 0.05,
    housewrap:  parseFloat(sys.waste_housewrap)  || 0.10,
    insulation: parseFloat(sys.waste_insulation) || 0.00,
  };

  // Default settings (Floor 1) used by legacy walls fallback
  const settings = resolveProjectSettings(projectRow, globalRow, LEVELS.FLOOR1, { wasteFactors });

  // Prefer floor plans (new polygon flow). Fall back to legacy walls table if no floor plan exists.
  const fpRows = (await query(
    'SELECT * FROM floor_plans WHERE project_id = $1 ORDER BY id', [id]
  )).rows;

  let wallItems = [];
  if (fpRows.length > 0) {
    for (const fp of fpRows) {
      if (fp.level === LEVELS.FOUNDATION) continue;
      if (fp.level === LEVELS.ROOF) continue;
      if (fp.level === LEVELS.FLOOR2 && Number(projectRow.num_storeys) < 2) continue;
      const lvlSettings = resolveProjectSettings(projectRow, globalRow, fp.level, { wasteFactors });
      const fpWalls = (await query(
        'SELECT * FROM floor_plan_walls WHERE floor_plan_id = $1 ORDER BY wall_index',
        [fp.id]
      )).rows;
      const fpOpenings = (await query(
        `SELECT o.* FROM openings o
         JOIN floor_plan_walls fpw ON fpw.id = o.floor_plan_wall_id
         WHERE fpw.floor_plan_id = $1`,
        [fp.id]
      )).rows;
      const fpInteriorRows = (await query(
        'SELECT * FROM floor_plan_interior_walls WHERE floor_plan_id = $1 ORDER BY id',
        [fp.id]
      )).rows;
      // Interior door openings live on floor_plan_interior_walls, not
      // floor_plan_walls. Pull them with a separate join and then key them
      // off the synthetic `iw-${id}` wall id used below.
      const intOpenings = (await query(
        `SELECT o.* FROM openings o
         JOIN floor_plan_interior_walls iw ON iw.id = o.floor_plan_interior_wall_id
         WHERE iw.floor_plan_id = $1`,
        [fp.id]
      )).rows;

      const polyWalls = buildFloorPlanWalls(fp.corners || [], fpWalls);
      const interiorWalls = fpInteriorRows.map((r) => ({
        id: `iw-${r.id}`,
        _interiorRowId: r.id,
        x1: Number(r.x1), y1: Number(r.y1), x2: Number(r.x2), y2: Number(r.y2),
        wall_type: r.wall_type,
        height: r.height != null ? Number(r.height) : null,
        on_concrete: !!r.on_concrete,
        sheathing_override: r.sheathing_override,
        drywall_override: r.drywall_override,
        extra_corner_studs: 0,
      }));
      const allWalls = [...polyWalls, ...interiorWalls];
      if (allWalls.length === 0) continue;

      const openingsByWallId = new Map();
      for (const o of fpOpenings) {
        const key = o.floor_plan_wall_id;
        if (key == null) continue;
        if (!openingsByWallId.has(key)) openingsByWallId.set(key, []);
        openingsByWallId.get(key).push(o);
      }
      const intWallByRowId = new Map(interiorWalls.map((w) => [w._interiorRowId, w]));
      for (const o of intOpenings) {
        const iw = intWallByRowId.get(o.floor_plan_interior_wall_id);
        if (!iw) continue;
        if (!openingsByWallId.has(iw.id)) openingsByWallId.set(iw.id, []);
        openingsByWallId.get(iw.id).push(o);
      }
      const enrichedOpenings = [
        ...fpOpenings.map((o) => {
          const w = polyWalls.find((x) => x.id === o.floor_plan_wall_id);
          return { ...o, wall_id: o.floor_plan_wall_id, wall_type: w?.wall_type };
        }),
        ...intOpenings.map((o) => {
          const iw = intWallByRowId.get(o.floor_plan_interior_wall_id);
          return { ...o, wall_id: iw?.id, wall_type: iw?.wall_type };
        }),
      ];

      for (const w of allWalls) {
        wallItems.push(...computeWallMaterials(w, lvlSettings, openingsByWallId.get(w.id) || [], fp.level));
      }
      wallItems.push(...computeProjectMaterials(allWalls, lvlSettings, enrichedOpenings, fp.level));
    }
  } else {
    const openings = (await query(
      'SELECT * FROM openings WHERE project_id = $1 AND wall_id IS NOT NULL', [id]
    )).rows;
    const wallById = new Map(walls.map((w) => [w.id, w]));
    const openingsByWall = new Map();
    const enrichedOpenings = [];
    for (const o of openings) {
      if (!openingsByWall.has(o.wall_id)) openingsByWall.set(o.wall_id, []);
      openingsByWall.get(o.wall_id).push(o);
      enrichedOpenings.push({ ...o, wall_type: wallById.get(o.wall_id)?.wall_type });
    }
    for (const w of walls) {
      wallItems.push(...computeWallMaterials(w, settings, openingsByWall.get(w.id) || []));
    }
    wallItems.push(...computeProjectMaterials(walls, settings, enrichedOpenings));
  }

  // Roof items: polygon-based sections drive area/ridge/hip/valley math.
  // The old roofs row is kept around solely for project-level settings
  // (sheathing_type, rafter_spacing). Projects predating the polygon roof
  // will have a roofs row but no roof_sections — they show no roof items
  // until the user redraws in the new tool.
  const roofRow = (await query(
    'SELECT sheathing_type, rafter_spacing FROM roofs WHERE project_id = $1 ORDER BY id LIMIT 1',
    [id]
  )).rows[0] || {};
  const roofSections = (await query(
    'SELECT * FROM roof_sections WHERE project_id = $1 ORDER BY id', [id]
  )).rows;
  // Collect identity keys for any row we override with extracted values. The
  // `is_extracted` flag is re-applied to the final output after sumMaterials
  // strips unknown fields, so we need a way to find those rows again.
  const extractedKeys = new Set();
  const extractedKey = (section, category, name, unit) =>
    `${(section || '').toLowerCase()}|${(category || '').toLowerCase()}|${(name || '').toLowerCase()}|${(unit || '').toLowerCase()}`;
  let roofItems = [];
  if (roofSections.length > 0) {
    const roofEdges = (await query(
      `SELECT e.* FROM roof_section_edges e
       JOIN roof_sections s ON s.id = e.section_id
       WHERE s.project_id = $1
       ORDER BY e.section_id, e.edge_index`,
      [id]
    )).rows;
    const edgesBySection = new Map();
    for (const e of roofEdges) {
      if (!edgesBySection.has(e.section_id)) edgesBySection.set(e.section_id, []);
      edgesBySection.get(e.section_id).push(e);
    }
    const sectionsWithEdges = roofSections.map((s) => ({
      ...s,
      edges: edgesBySection.get(s.id) || [],
    }));
    roofItems = computeRoofMaterials(sectionsWithEdges, {
      sheathing_type: roofRow.sheathing_type,
      rafter_spacing: roofRow.rafter_spacing,
    });
  }

  // AI-extracted roof overrides. When the user has confirmed extracted values
  // from a PDF, those quantities replace the polygon-calculated ones for the
  // matching rows. Rows touched here get `is_extracted: true` so the frontend
  // can badge them ("from plan"). This runs even when there are NO roof
  // sections — sheathing/ridge/valley/hip rows are synthesized from the
  // extracted values alone so the user gets a roof rollup without having to
  // draw the polygon first.
  const extracted = {
    sheathing_sf: projectRow.extracted_sheathing_sf == null ? null : Number(projectRow.extracted_sheathing_sf),
    valley_lf:    projectRow.extracted_valley_lf    == null ? null : Number(projectRow.extracted_valley_lf),
    ridge_lf:     projectRow.extracted_ridge_lf     == null ? null : Number(projectRow.extracted_ridge_lf),
    hip_lf:       projectRow.extracted_hip_lf       == null ? null : Number(projectRow.extracted_hip_lf),
  };
  const hasAnyExtracted =
    extracted.sheathing_sf != null || extracted.valley_lf != null ||
    extracted.ridge_lf != null || extracted.hip_lf != null;
  if (hasAnyExtracted) {
    const sheathingKey = roofRow.sheathing_type || 'plywood_1_2_csp';
    const sheathingName =
      sheathingKey === 'osb_7_16'    ? '4 X 8 - 7/16 ORIENTED STRAND BOARD' :
      sheathingKey === 'plywood_5_8' ? '4 X 8 - 5/8 STD.SPRUCE PLYWOOD' :
                                       '4 X 8 - 1/2 STD.SPRUCE PLYWOOD';
      const ROOF_SECTION = 'Roof';
      const overrides = {
        // Match key = section + category + name. Values keep matching
        // computeRoofMaterials so the post-process can find them by row, or
        // synthesize one if no calc row exists yet (e.g. polygon not drawn).
        Sheathing: extracted.sheathing_sf == null ? null : {
          name: sheathingName, unit: 'EA',
          // Convert area → sheet count using the same 32sf/sheet + waste
          // factor wallRules.js uses (SHEET_WASTE constant = 0.10).
          quantity: Math.ceil(Number(extracted.sheathing_sf) / 32) * 1.10,
        },
        Ridge: extracted.ridge_lf == null ? null : {
          name: 'RIDGE (linear feet)', unit: 'LF', quantity: Number(extracted.ridge_lf),
        },
        Valley: extracted.valley_lf == null ? null : {
          name: 'VALLEY FLASHING (linear feet)', unit: 'LF', quantity: Number(extracted.valley_lf),
        },
        Hip: extracted.hip_lf == null ? null : {
          name: 'HIP FLASHING (linear feet)', unit: 'LF', quantity: Number(extracted.hip_lf),
        },
      };
      for (const [category, ov] of Object.entries(overrides)) {
        if (!ov) continue;
        // Sheathing rows come back from computeRoofMaterials with category =
        // 'Sheathing'; the other three use the same string as the key here.
        const idx = roofItems.findIndex((it) =>
          (it.section === ROOF_SECTION) &&
          (it.category === category)
        );
        if (idx >= 0) {
          roofItems[idx] = { ...roofItems[idx], ...ov };
        } else {
          roofItems.push({ section: ROOF_SECTION, category, ...ov });
        }
        extractedKeys.add(extractedKey(ROOF_SECTION, category, ov.name, ov.unit));
      }
  }
  wallItems.push(...roofItems);

  // Floor items (subfloor + adhesive + ceiling drywall)
  const floorRow = (await query(
    'SELECT * FROM floors WHERE project_id = $1 ORDER BY id LIMIT 1', [id]
  )).rows[0];
  if (floorRow) {
    const overrideSf = Number(floorRow.floor_area_sf) || 0;
    const autoSf = Number(floorRow.auto_floor_area_sf) || 0;
    const areaSf = overrideSf > 0 ? overrideSf : autoSf;
    if (areaSf > 0) {
      const lvl = floorRow.level || 'floor1';
      const floorSection = sectionFor('FLOOR', lvl);
      const subfloorName = floorRow.subfloor_type === '34tgcsp'
        ? '4 X 8 - 3/4 T&G STD.SPRUCE PLY'
        : '4 X 8 - 5/8 T&G STD.SPRUCE PLY';
      wallItems.push({
        section: floorSection, category: 'Subfloor',
        name: subfloorName, unit: 'EA',
        quantity: Math.ceil(areaSf / 32) * (1 + wasteFactors.sheet),
      });
      wallItems.push({
        section: floorSection, category: 'Subfloor Adhesive',
        name: 'ADHSV,CNSTR PL PREM PNT825ML', unit: 'EA',
        quantity: Math.ceil(areaSf / 500),
      });
      const cdwKey = projectRow.ceiling_drywall_type || '41212dw';
      const ceilingSheet = cdwKey === '41012dw'
        ? { name: '4 X 10 - 1/2" DRYWALL', sheetSf: 40 }
        : { name: '4 X 12 - 1/2" DRYWALL', sheetSf: 48 };
      wallItems.push({
        section: sectionFor('FINISHINGS', lvl), category: 'Ceiling Drywall',
        name: ceilingSheet.name, unit: 'sheet',
        quantity: Math.ceil(areaSf / ceilingSheet.sheetSf) * (1 + wasteFactors.sheet),
      });
    }
  }

  const wallRolled = sumMaterials(wallItems);

  const wallWithIds = [];
  for (const item of wallRolled) {
    const matId = await ensureMaterial(item.name, item.unit);
    wallWithIds.push({
      material_id: matId,
      material_name: item.name,
      material_unit: item.unit,
      section: item.section,
      category: item.category,
      total_quantity: item.quantity,
    });
  }

  const merged = new Map();
  const mkKey = (matId, section, category) => `${matId}|${section ?? ''}|${category ?? ''}`;
  for (const r of measurementRollup.rows) {
    merged.set(mkKey(r.material_id, null, null), {
      material_id: r.material_id,
      material_name: r.material_name,
      material_unit: r.material_unit,
      section: null,
      category: null,
      total_quantity: Number(r.total_quantity),
    });
  }
  for (const r of wallWithIds) {
    const k = mkKey(r.material_id, r.section, r.category);
    const existing = merged.get(k);
    if (existing) existing.total_quantity += r.total_quantity;
    else merged.set(k, r);
  }

  const out = Array.from(merged.values())
    .map((r) => ({ ...r, total_quantity: Math.max(0, Math.ceil(r.total_quantity - 1e-9)) }))
    .sort((a, b) => {
      const ra = sectionRank(a.section);
      const rb = sectionRank(b.section);
      if (ra !== rb) return ra - rb;
      const ca = categoryRank(a.category);
      const cb = categoryRank(b.category);
      if (ca !== cb) return ca - cb;
      return a.material_name.localeCompare(b.material_name);
    });

  // Apply per-project material overrides
  const overrideRows = (await query(
    'SELECT original_description, override_description FROM material_overrides WHERE project_id = $1', [id]
  )).rows;
  const overrideMap = new Map(
    overrideRows.map((o) => [o.original_description.trim().toLowerCase(), o.override_description])
  );
  for (const r of out) {
    const key = (r.material_name || '').trim().toLowerCase();
    const sub = overrideMap.get(key);
    if (sub) {
      r.original_description = r.material_name;
      r.material_name = sub;
      r.modified = true;
    } else {
      r.modified = false;
    }
    // Re-apply the "from plan" badge that sumMaterials dropped. Match against
    // the original (pre-rename) description so renamed roof rows still flag.
    const matchName = r.original_description || r.material_name;
    r.is_extracted = extractedKeys.has(
      extractedKey(r.section, r.category, matchName, r.material_unit)
    );
  }

  // Attach SKU catalog metadata. The description column is the wall-rules
  // match key; warehouse_description is the customer-facing label and may
  // differ (e.g. "FILM,12\" CGSB SF CLR 300SF" vs "12 X 300FT CLEAR POLY").
  const skuRows = (await query(
    'SELECT item_number, catalog_number, description, warehouse_description, definition FROM sku_catalog'
  )).rows;
  const skuByDesc = new Map();
  for (const s of skuRows) {
    if (!s.description) continue;
    skuByDesc.set(s.description.trim().toLowerCase(), s);
  }
  for (const r of out) {
    const sku = skuByDesc.get((r.material_name || '').trim().toLowerCase());
    r.catalog_number = sku?.catalog_number ?? null;
    r.item_number = sku?.item_number ?? null;
    r.warehouse_description = sku?.warehouse_description ?? null;
    const origKey = (r.original_description || r.material_name || '').trim().toLowerCase();
    r.definition = skuByDesc.get(origKey)?.definition ?? null;
  }

  // Append packages
  const packageRows = (await query(
    'SELECT * FROM packages WHERE project_id = $1 ORDER BY id', [id]
  )).rows;
  const packagesSection = sectionFor('PACKAGES');
  for (const p of packageRows) {
    out.push({
      material_id: `pkg-${p.id}`,
      package_id: p.id,
      material_name: p.name,
      material_unit: p.unit || 'PKG',
      section: packagesSection,
      category: p.notes || null,
      total_quantity: Number(p.quantity),
      catalog_number: null,
      item_number: null,
      definition: null,
      modified: false,
      is_package: true,
      package_type: p.package_type,
      package_cost: p.cost,
      package_price1: p.price1,
      package_price2: p.price2,
      package_price3: p.price3,
      package_price4: p.price4,
    });
  }

  // Apply deletions
  const delRows = (await query(
    'SELECT id, description, section FROM material_deletions WHERE project_id = $1', [id]
  )).rows;
  const delKeys = new Set(delRows.map((d) =>
    `${(d.section || '').trim().toLowerCase()}|${(d.description || '').trim().toLowerCase()}`
  ));
  const delIdByKey = new Map(delRows.map((d) =>
    [`${(d.section || '').trim().toLowerCase()}|${(d.description || '').trim().toLowerCase()}`, d.id]
  ));
  const filtered = [];
  for (const r of out) {
    const matchDesc = r.original_description || r.material_name;
    const key = `${(r.section || '').trim().toLowerCase()}|${(matchDesc || '').trim().toLowerCase()}`;
    if (delKeys.has(key)) {
      if (includeDeleted) {
        filtered.push({ ...r, deleted: true, deletion_id: delIdByKey.get(key) });
      }
      continue;
    }
    filtered.push({ ...r, deleted: false });
  }

  return filtered;
}
