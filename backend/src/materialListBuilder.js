import { query } from './db.js';
import {
  computeWallMaterials,
  computeProjectMaterials,
  computeRoofMaterials,
  computeWindowAccessoryMaterials,
  computeAtticInsulationMaterials,
  buildFloorPlanWalls,
  sumMaterials,
  resolveProjectSettings,
  roofSectionGeometry,
  valleyBetween,
  sectionFor,
  sectionRank,
  categoryRank,
  LEVELS,
  SOLO_SECTIONS,
} from './wallRules.js';
import { ensureMaterial } from './materialUpsert.js';
import { computeDeckMaterials } from './deckRules.js';
import { computeRoofFinishingMaterials } from './roofFinishingRules.js';
import { computeSoffitFasciaMaterials } from './soffitFasciaRules.js';
import { computeSidingMaterials } from './sidingRules.js';
import { computeFloorSystemMaterials } from './floorSystemRules.js';
import { computeDrywallFinishingMaterials } from './drywallFinishingRules.js';

// ---------- helpers (org-agnostic; pure functions) ----------

// Pitch run-over-rise (decimal). Local copy so we don't have to export the
// helper from wallRules.js — it's two lines and parsing-only.
function pitchRiseRun(pitch) {
  const m = /^(\d+):12$/.exec(pitch || '');
  return m ? Number(m[1]) / 12 : 0.5;
}

// Aggregate per-section roof geometry into the totals object the
// roofFinishingRules + soffitFasciaRules modules consume. Uses the existing
// exports from wallRules.js so the math stays in lockstep with the roof
// sheathing calc.
function aggregateRoofGeometry(sectionsWithEdges) {
  const totals = {
    total_roof_area: 0, total_eave_lf: 0, total_rake_lf: 0,
    total_ridge_lf: 0, total_hip_lf: 0, total_valley_lf: 0,
    avg_overhang_ft: 0,
  };
  if (!Array.isArray(sectionsWithEdges) || sectionsWithEdges.length === 0) {
    return totals;
  }
  let weightedOverhangSum = 0;
  for (const sec of sectionsWithEdges) {
    const g = roofSectionGeometry(sec);
    totals.total_roof_area += g.surfaceArea;
    totals.total_eave_lf   += g.eavePerimeter;
    totals.total_rake_lf   += g.rakePerimeter;
    totals.total_ridge_lf  += g.ridgeLength;
    totals.total_hip_lf    += g.hipLength;
    weightedOverhangSum    += g.eavePerimeter * g.avgOverhang;
  }
  for (let i = 0; i < sectionsWithEdges.length; i++) {
    for (let j = i + 1; j < sectionsWithEdges.length; j++) {
      totals.total_valley_lf += valleyBetween(sectionsWithEdges[i], sectionsWithEdges[j]);
    }
  }
  totals.avg_overhang_ft = totals.total_eave_lf > 0
    ? weightedOverhangSum / totals.total_eave_lf
    : 0;
  return totals;
}

// Sum of gable triangle areas. Per spec:
//   gable_base   = edge length × 2  (full span at that gable)
//   gable_height = (gable_base / 2) × (rise/run)
//   gable_area   = 0.5 × base × height
// Edge lengths use the section's polygon corners (grid units multiplied by
// scale to get feet).
function sumGableAreasSf(sectionsWithEdges, scale) {
  if (!Array.isArray(sectionsWithEdges)) return 0;
  let total = 0;
  for (const sec of sectionsWithEdges) {
    const pitch = pitchRiseRun(sec.pitch || '6:12');
    const corners = Array.isArray(sec.corners) ? sec.corners : [];
    const edges = Array.isArray(sec.edges) ? sec.edges : [];
    for (const e of edges) {
      if (e.end_type !== 'gable') continue;
      const i = Number(e.edge_index);
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      if (!a || !b) continue;
      const len = Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y)) * scale;
      const gableBase = len * 2;
      const gableHeight = (gableBase / 2) * pitch;
      total += 0.5 * gableBase * gableHeight;
    }
  }
  return total;
}

// Closed-polygon perimeter (feet, given scaleFtPerGrid).
function polygonPerimeterFt(corners, scale) {
  if (!Array.isArray(corners) || corners.length < 3) return 0;
  let p = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    p += Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
  }
  return p * scale;
}

// Count convex corners (interior angle < 180°) of a closed polygon.
// "Outside" corners drive vinyl siding outside-corner trim and drywall
// corner bead. Uses signed cross-product against the polygon's winding.
function outsideCornerCount(corners) {
  if (!Array.isArray(corners) || corners.length < 3) return 0;
  let signed = 0;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i], q = corners[(i + 1) % corners.length];
    signed += Number(p.x) * Number(q.y) - Number(q.x) * Number(p.y);
  }
  const ccw = signed > 0;
  let count = 0;
  for (let i = 0; i < corners.length; i++) {
    const prev = corners[(i - 1 + corners.length) % corners.length];
    const cur  = corners[i];
    const next = corners[(i + 1) % corners.length];
    const ax = Number(cur.x) - Number(prev.x);
    const ay = Number(cur.y) - Number(prev.y);
    const bx = Number(next.x) - Number(cur.x);
    const by = Number(next.y) - Number(cur.y);
    const cross = ax * by - ay * bx;
    if ((ccw && cross > 0) || (!ccw && cross < 0)) count++;
  }
  return count;
}

// Distance from point p to closed segment a→b. Grid units in, grid units out.
function distPointToSegmentG(p, a, b) {
  const ax = Number(a.x), ay = Number(a.y);
  const bx = Number(b.x), by = Number(b.y);
  const px = Number(p.x), py = Number(p.y);
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Count interior-wall endpoints (T-junctions) that terminate at an
// exterior-wall polygon edge. Snap distance 1ft, converted to grid units
// via scale. One increment per qualifying endpoint.
function interiorJunctionCount(interiorWallRows, exteriorCorners, scale) {
  if (!Array.isArray(interiorWallRows) || interiorWallRows.length === 0) return 0;
  if (!Array.isArray(exteriorCorners) || exteriorCorners.length < 3) return 0;
  const snapGrid = 1.0 / (scale || 1);
  let count = 0;
  for (const iw of interiorWallRows) {
    const eps = [
      { x: Number(iw.x1), y: Number(iw.y1) },
      { x: Number(iw.x2), y: Number(iw.y2) },
    ];
    for (const ep of eps) {
      for (let i = 0; i < exteriorCorners.length; i++) {
        const a = exteriorCorners[i];
        const b = exteriorCorners[(i + 1) % exteriorCorners.length];
        if (distPointToSegmentG(ep, a, b) <= snapGrid) {
          count++;
          break;
        }
      }
    }
  }
  return count;
}

// Framing-nail helpers. "2 X 4 X 16 PREMIUM SPRUCE" → 16ft. Precut studs
// like "2 X 4 X 92-5/8 PREMIUM SPRUCE" → 92.625" → 7.72ft.
function isLumberItem(name) {
  return /^\d+\s*X\s*\d+\s*X\s*[\d/\-]+\s+(PREMIUM SPRUCE|PRESSURE TREATED)\b/i.test(name || '');
}
function parseLumberLengthFt(name) {
  const m = /^\d+\s*X\s*\d+\s*X\s*([\d/\-]+)\s+(PREMIUM SPRUCE|PRESSURE TREATED)\b/i.exec(name || '');
  if (!m) return 0;
  const lengthStr = m[1];
  if (lengthStr.includes('-')) {
    // Mixed inches like "92-5/8" → inches → ft
    const [intPart, frac] = lengthStr.split('-');
    const [num, den] = (frac || '').split('/');
    const inches = Number(intPart) + (Number(num) / Number(den || 1) || 0);
    return inches / 12;
  }
  if (lengthStr.includes('/')) {
    const [num, den] = lengthStr.split('/');
    return Number(num) / Number(den);
  }
  const n = Number(lengthStr);
  return Number.isFinite(n) ? n : 0;
}

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
    // Deck-specific waste factors. Fall back to the spec defaults when the
    // system_settings rows haven't been migrated in yet on a fresh DB.
    deck_decking:  parseFloat(sys.deck_waste_decking)  || 0.10,
    deck_framing:  parseFloat(sys.deck_waste_framing)  || 0.05,
    deck_concrete: parseFloat(sys.deck_waste_concrete) || 0.05,
    // AUTO-calculation module waste factors. Org-scoping hook: when
    // org-aware settings land, this single object is the chokepoint —
    // every rules engine reads through settings.wasteFactors and never
    // touches system_settings directly.
    roof_shingles:    parseFloat(sys.roof_shingles_waste)    || 0.10,
    siding:           parseFloat(sys.siding_waste)           || 0.10,
    siding_gable:     parseFloat(sys.siding_gable_waste)     || 0.10,
    floor_framing:    parseFloat(sys.floor_framing_waste)    || 0.05,
    attic_insulation: parseFloat(sys.attic_insulation_waste) || 0.05,
  };

  // Framing-nail LF-per-box ratios — adjustable via the Defaults page so
  // Spencer can calibrate to the yard's actual product without a code
  // change. Defaults to 2000 LF/box for 3-1/4" and 3000 LF/box for 2-3/8".
  const framingNailsLfPerBox325  = parseFloat(sys.framing_nails_lf_per_box_3_25)  || 2000;
  const framingNailsLfPerBox2375 = parseFloat(sys.framing_nails_lf_per_box_2_375) || 3000;

  // Default settings (Floor 1) used by legacy walls fallback
  const settings = resolveProjectSettings(projectRow, globalRow, LEVELS.FLOOR1, { wasteFactors });

  // Prefer floor plans (new polygon flow). Fall back to legacy walls table if no floor plan exists.
  const fpRows = (await query(
    'SELECT * FROM floor_plans WHERE project_id = $1 ORDER BY id', [id]
  )).rows;

  // Cross-floor accumulators used by Siding, Drywall Finishing, and the
  // Floor System modules after the floor loop completes. Per the audit:
  // - exteriorPolygonByLevel + interiorWallRowsByLevel come from
  //   floor_plans tables (not floors).
  // - openingAggregates sums opening widths/heights/perimeters across
  //   every exterior opening on every floor (excludes interior doors —
  //   they live on interior walls, not exterior).
  const exteriorPolygonByLevel = {};
  const interiorWallRowsByLevel = {};
  const heightByLevel = {};
  const openingAggregates = {
    opening_areas_sf: 0,
    all_opening_widths_lf: 0,
    window_widths_lf: 0,
    all_opening_perimeter_lf: 0,
  };

  let wallItems = [];
  if (fpRows.length > 0) {
    for (const fp of fpRows) {
      if (fp.level === LEVELS.FOUNDATION) continue;
      if (fp.level === LEVELS.ROOF) continue;
      if (fp.level === LEVELS.FLOOR2 && Number(projectRow.num_storeys) < 2) continue;
      const lvlSettings = resolveProjectSettings(projectRow, globalRow, fp.level, { wasteFactors });
      // Stash polygon + level height for the post-loop modules.
      exteriorPolygonByLevel[fp.level] = Array.isArray(fp.corners) ? fp.corners : [];
      heightByLevel[fp.level] = lvlSettings.wallHeight;
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

      interiorWallRowsByLevel[fp.level] = fpInteriorRows;

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

      // Module 3: Window & Door Accessories — per floor, pushed right after
      // the existing header/jack rows for this level. Only exterior
      // openings get exterior accessories (interior doors are filtered
      // inside the rules engine via wall_type).
      const accessoryInput = enrichedOpenings.map((o) => ({
        type: o.type,
        rough_opening_width: o.rough_opening_width,
        rough_opening_height: o.rough_opening_height,
        wall_type: o.wall_type,
      }));
      wallItems.push(...computeWindowAccessoryMaterials(accessoryInput, { wasteFactors }, fp.level));

      // Accumulate exterior opening geometry for Siding (modules 4) so the
      // single post-loop call sees totals across every floor.
      for (const o of enrichedOpenings) {
        const isExterior = o.type === 'window' ||
          (o.type === 'door' && o.wall_type === 'exterior_2x6');
        if (!isExterior) continue;
        const w = Number(o.rough_opening_width) / 12;
        const h = Number(o.rough_opening_height) / 12;
        openingAggregates.opening_areas_sf       += w * h;
        openingAggregates.all_opening_widths_lf  += w;
        openingAggregates.all_opening_perimeter_lf += 2 * (w + h);
        if (o.type === 'window') openingAggregates.window_widths_lf += w;
      }
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
  // Captured here so modules 1, 2, and 4 (siding gables) can reuse them
  // after the roof block runs — avoids re-querying.
  let sectionsWithEdges = [];
  let roofGeometryTotals = null;
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
    sectionsWithEdges = roofSections.map((s) => ({
      ...s,
      edges: edgesBySection.get(s.id) || [],
    }));
    roofItems = computeRoofMaterials(sectionsWithEdges, {
      sheathing_type: roofRow.sheathing_type,
      rafter_spacing: roofRow.rafter_spacing,
    });
    roofGeometryTotals = aggregateRoofGeometry(sectionsWithEdges);
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

  // Module 1: Roof Finishing — runs whenever we have either polygon-derived
  // roof geometry (sectionsWithEdges) or AI-extracted totals from the PDF.
  // Falls back to the extracted values to fill in totals when the polygon
  // wasn't drawn.
  if (roofGeometryTotals || hasAnyExtracted) {
    const fallback = {
      total_roof_area: Number(extracted.sheathing_sf) || 0,
      total_eave_lf:   0,
      total_rake_lf:   0,
      total_ridge_lf:  Number(extracted.ridge_lf) || 0,
      total_hip_lf:    Number(extracted.hip_lf)   || 0,
      total_valley_lf: Number(extracted.valley_lf) || 0,
      avg_overhang_ft: 0,
    };
    const totals = roofGeometryTotals || fallback;
    wallItems.push(...computeRoofFinishingMaterials(totals, { wasteFactors }));

    // Module 2: Soffit & Fascia — keyed off eave + rake LF and the
    // eave-weighted avg overhang already computed in aggregateRoofGeometry.
    if (roofGeometryTotals) {
      wallItems.push(...computeSoffitFasciaMaterials({
        eave_lf: roofGeometryTotals.total_eave_lf,
        rake_lf: roofGeometryTotals.total_rake_lf,
        avg_overhang_ft: roofGeometryTotals.avg_overhang_ft,
      }, { wasteFactors }));
    }
  }

  // Floor items (subfloor + adhesive + ceiling drywall). Loads ALL floor
  // rows now (previously LIMIT 1) so the Floor System module gets floor1
  // and Attic Insulation can find the top floor. Existing subfloor logic
  // still runs on the first row only to preserve current behaviour.
  const allFloors = (await query(
    'SELECT * FROM floors WHERE project_id = $1 ORDER BY id', [id]
  )).rows;
  const floorByLevel = new Map();
  for (const f of allFloors) floorByLevel.set(f.level || 'floor1', f);
  const floorRow = allFloors[0];
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

  // Module 5: Floor System.
  // Audit-confirmed split: floor AREA comes from the floors table
  // (auto_floor_area_sf / floor_area_sf — already cached), but the floor
  // POLYGON comes from floor_plans.corners (raw grid units). We always use
  // floor 1 because the floor system sits over the foundation — upper-storey
  // joists already get framed into the wall section above.
  const scaleFtPerGrid = Number(projectRow.scale_ft_per_grid) || 1;
  {
    const floor1Row = floorByLevel.get('floor1') || floorRow;
    const floor1Polygon = exteriorPolygonByLevel.floor1 || [];
    const floor1AreaSf = floor1Row
      ? (Number(floor1Row.floor_area_sf) || Number(floor1Row.auto_floor_area_sf) || 0)
      : 0;
    if (floor1Polygon.length >= 3 && floor1AreaSf > 0) {
      const perimeterFt = polygonPerimeterFt(floor1Polygon, scaleFtPerGrid);
      const floorSystemItems = computeFloorSystemMaterials({
        floor_area_sf:      floor1AreaSf,
        floor_perimeter_ft: perimeterFt,
        floor_polygon:      floor1Polygon,
        joist_size:         projectRow.joist_size || '2x8',
        joist_spacing_in:   Number(projectRow.joist_spacing_in) || 16,
        foundation_type:    projectRow.foundation_type || 'basement',
        scaleFtPerGrid,
      }, { wasteFactors });
      wallItems.push(...floorSystemItems);
    }
  }

  // Module 6: Attic Insulation — uses the TOP floor's ceiling area.
  // For 2-storey: floor2 area. For single-storey: floor1 area. The floor
  // row may be missing for the top floor in single-storey projects if the
  // user hasn't created one explicitly; fall back to the floor_plans
  // auto_floor_area_sf in that case.
  {
    const topLevel = Number(projectRow.num_storeys) >= 2 ? 'floor2' : 'floor1';
    const topFloorRow = floorByLevel.get(topLevel);
    let topCeilingSf = topFloorRow
      ? (Number(topFloorRow.floor_area_sf) || Number(topFloorRow.auto_floor_area_sf) || 0)
      : 0;
    if (topCeilingSf <= 0) {
      // Fall back to the floor_plans polygon-derived area (cached during
      // PUT /:id/floor-plans), which is set even when no floors row exists.
      const fp = fpRows.find((r) => r.level === topLevel);
      topCeilingSf = fp ? (Number(fp.auto_floor_area_sf) || 0) : 0;
    }
    if (topCeilingSf > 0) {
      wallItems.push(...computeAtticInsulationMaterials({
        ceiling_area_sf:       topCeilingSf,
        attic_insulation_type: projectRow.attic_insulation_type || 'blown_in',
        attic_r_value:         projectRow.attic_r_value || 'r40',
      }, { wasteFactors }));
    }
  }

  // Deck items: load each deck + its stairs, compute via deckRules, append
  // with a per-deck section name when more than one deck exists so they
  // render as separate subsections in the material list.
  const decks = (await query(
    'SELECT * FROM decks WHERE project_id = $1 ORDER BY id', [id]
  )).rows;
  if (decks.length > 0) {
    const allStairs = (await query(
      `SELECT s.* FROM deck_stairs s
       JOIN decks d ON d.id = s.deck_id
       WHERE d.project_id = $1
       ORDER BY s.deck_id, s.id`,
      [id]
    )).rows;
    const stairsByDeck = new Map();
    for (const s of allStairs) {
      if (!stairsByDeck.has(s.deck_id)) stairsByDeck.set(s.deck_id, []);
      stairsByDeck.get(s.deck_id).push(s);
    }
    const deckSettings = {
      scaleFtPerGrid: Number(projectRow.scale_ft_per_grid) || 1,
      wasteFactors,
    };
    for (const d of decks) {
      const sectionLabel = decks.length > 1 ? `Deck — ${d.name || 'Deck'}` : 'Deck';
      const stairs = stairsByDeck.get(d.id) || [];
      wallItems.push(
        ...computeDeckMaterials(d, stairs, deckSettings, { sectionLabel })
      );
    }
  }

  // Module 4: Siding — single post-loop call, aggregated geometry across
  // every drawn exterior floor. Uses the floor1 polygon for perimeter +
  // corner count (assumed identical on each storey), sums heights across
  // floors, sums opening areas, and pulls gable areas from the roof
  // sections.
  {
    const floor1Polygon = exteriorPolygonByLevel.floor1 || [];
    const floor2Polygon = exteriorPolygonByLevel.floor2 || [];
    const wallPerimeter = polygonPerimeterFt(floor1Polygon, scaleFtPerGrid);
    const floor1Height = Number(heightByLevel.floor1) || 0;
    const floor2Height = Number(projectRow.num_storeys) >= 2
      ? Number(heightByLevel.floor2 || projectRow.floor2_wall_height) || 0
      : 0;
    const totalHeight = floor1Height + floor2Height;
    const cornerCount = outsideCornerCount(floor1Polygon);
    const gableAreasSf = sumGableAreasSf(sectionsWithEdges, scaleFtPerGrid);
    if (wallPerimeter > 0 && totalHeight > 0) {
      wallItems.push(...computeSidingMaterials({
        wall_perimeter_ft:       wallPerimeter,
        wall_height_ft:          totalHeight,
        opening_areas_sf:        openingAggregates.opening_areas_sf,
        outside_corner_count:    cornerCount,
        gable_areas_sf:          gableAreasSf,
        all_opening_widths_lf:   openingAggregates.all_opening_widths_lf,
        window_widths_lf:        openingAggregates.window_widths_lf,
        all_opening_perimeter_lf: openingAggregates.all_opening_perimeter_lf,
      }, { wasteFactors }));
    }
    // Silence unused-warning: floor2Polygon would only be needed if we
    // wanted to handle stepped foundations (different polygon per storey).
    // The single-polygon assumption is intentional for now.
    void floor2Polygon;
  }

  // Module 7: Drywall Finishing — aggregates total wall + ceiling drywall
  // SF from the rows we've already pushed for walls (wallRules) and the
  // ceiling sheet pushed in the floor block above. We back-derive ceiling
  // SF from the top-floor area used by the attic block.
  {
    // Sum wall drywall + ceiling drywall rows already in wallItems (these
    // are the only drywall rows the system produces). Quantities are in
    // sheets; multiply by SF-per-sheet (32, 36, 40, 48) parsed from the
    // sheet name to get back to SF. Easier path: re-derive from polygon
    // perimeters and ceiling area — keeps the math independent of how
    // wallRules.js bins the sheets.
    let wallDrywallSf = 0;
    for (const fp of fpRows) {
      if (fp.level === LEVELS.FOUNDATION) continue;
      if (fp.level === LEVELS.ROOF) continue;
      if (fp.level === LEVELS.FLOOR2 && Number(projectRow.num_storeys) < 2) continue;
      const corners = Array.isArray(fp.corners) ? fp.corners : [];
      if (corners.length < 3) continue;
      const perim = polygonPerimeterFt(corners, scaleFtPerGrid);
      const heightFt = Number(heightByLevel[fp.level]) || 0;
      // Exterior wall drywall is 1× area; interior walls double-side it.
      // We approximate the total as the exterior gross wall area + an
      // assumed equal interior contribution. The rules engine only cares
      // about the total SF; under-count would mean under-budget tape/mud.
      // For a typical layout, interior wall surface area roughly equals
      // exterior, hence the ×2 multiplier on the gross.
      wallDrywallSf += perim * heightFt * 2;
      // Subtract exterior openings (interior openings stay since they have
      // jamb returns).
      // Best-effort: openings were summed across all floors already.
      // Splitting per-floor would require another loop — accepting the
      // approximation that openings reduce SF on both wall faces.
    }
    wallDrywallSf = Math.max(0, wallDrywallSf - openingAggregates.opening_areas_sf);

    // Ceiling area = floor 1 area (or top floor for single-storey; same row).
    const ceilingSf = (() => {
      const r = floorByLevel.get('floor1') || floorRow;
      if (!r) return 0;
      return Number(r.floor_area_sf) || Number(r.auto_floor_area_sf) || 0;
    })();
    const totalDrywallSf = wallDrywallSf + ceilingSf;

    // Corner counts.
    const exteriorCorners = outsideCornerCount(exteriorPolygonByLevel.floor1 || []);
    let intJunctions = 0;
    for (const lvl of Object.keys(interiorWallRowsByLevel)) {
      const interior = interiorWallRowsByLevel[lvl] || [];
      const polygon = exteriorPolygonByLevel[lvl] || [];
      intJunctions += interiorJunctionCount(interior, polygon, scaleFtPerGrid);
    }

    // Wall height for corner LF — sum across floors so corner bead reflects
    // both storeys.
    const floor1Height = Number(heightByLevel.floor1) || 0;
    const floor2Height = Number(projectRow.num_storeys) >= 2
      ? Number(heightByLevel.floor2 || projectRow.floor2_wall_height) || 0
      : 0;
    const dwHeight = floor1Height + floor2Height;

    if (totalDrywallSf > 0) {
      wallItems.push(...computeDrywallFinishingMaterials({
        total_drywall_sf:             totalDrywallSf,
        ceiling_area_sf:              ceilingSf,
        wall_height_ft:               dwHeight,
        outside_corner_count:         exteriorCorners,
        interior_wall_junction_count: intJunctions,
      }, { wasteFactors }));
    }
  }

  // Module 8: Framing Nails — pushed BEFORE sumMaterials so the rollup
  // includes them. Scans every dimensional-lumber row already in wallItems
  // (every PREMIUM SPRUCE / PRESSURE TREATED piece) and sums LF × quantity,
  // then divides by adjustable LF-per-box ratios from system_settings.
  {
    let totalFramingLf = 0;
    for (const it of wallItems) {
      if (it.unit !== 'each' && it.unit !== 'EA') continue;
      if (!isLumberItem(it.name)) continue;
      const lengthFt = parseLumberLengthFt(it.name);
      if (lengthFt <= 0) continue;
      totalFramingLf += Number(it.quantity) * lengthFt;
    }
    if (totalFramingLf > 0) {
      const section = SOLO_SECTIONS.FRAMING_NAILS;
      const category = 'Framing Nails';
      wallItems.push({
        section, category,
        name: 'FRAMING NAILS 3-1/4IN STRIP BOX', unit: 'BX',
        quantity: totalFramingLf / framingNailsLfPerBox325,
      });
      wallItems.push({
        section, category,
        name: 'FRAMING NAILS 2-3/8IN STRIP BOX', unit: 'BX',
        quantity: totalFramingLf / framingNailsLfPerBox2375,
      });
    }
  }

  // Centre Beam in Floor System carries an engineer_review flag that
  // sumMaterials drops along with all other unknown fields. Capture its
  // identity now so we can re-apply the flag after the rollup runs.
  const engineerReviewKeys = new Set();
  for (const it of wallItems) {
    if (it.engineer_review) {
      engineerReviewKeys.add(
        `${(it.section || '').toLowerCase()}|${(it.name || '').toLowerCase()}`
      );
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
    // Re-apply the engineer_review flag (Centre Beam row from Module 5)
    // that sumMaterials dropped along with other unknown fields. Match on
    // (section, name) — same identity used when stashing the key above.
    if (engineerReviewKeys.has(`${(r.section || '').toLowerCase()}|${(matchName || '').toLowerCase()}`)) {
      r.engineer_review = true;
    }
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
