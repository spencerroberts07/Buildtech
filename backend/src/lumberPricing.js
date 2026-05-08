// Shared helpers for converting lumber MBF (price per thousand board feet) to
// per-piece pricing. Used by the import script (precomputes converted prices
// when storing rows) and the quote pricing lookup (handles legacy rows that
// haven't been re-imported yet).

// Parse standard lumber descriptions of the form "T X W X L" into thickness,
// width, length-in-feet, and total board feet per piece. Handles the alternate
// "-" separator ("1 X 4 - 16 SPRUCE STRAPPING") and length fractions like
// "92-5/8" (= 92.625"). Returns null if the description doesn't fit the lumber
// dimension shape.
export function parseLumberDimensions(description) {
  if (!description) return null;
  const m = description.match(/(\d+)\s*[Xx-]\s*(\d+)\s*[Xx-]\s*(\d+(?:-\d+\/\d+)?)/);
  if (!m) return null;
  const thickness = parseInt(m[1], 10);
  const width = parseInt(m[2], 10);
  const rawLen = m[3];
  if (rawLen.includes('-')) {
    // e.g. "92-5/8" → 92 + 5/8, given in inches
    const [whole, frac] = rawLen.split('-');
    const [num, den] = frac.split('/').map((s) => parseInt(s, 10));
    if (!den) return null;
    const lengthIn = parseInt(whole, 10) + num / den;
    return {
      thickness, width,
      length_ft: Math.round((lengthIn / 12) * 1000) / 1000,
      board_feet: (thickness * width * lengthIn) / 144,
    };
  }
  // Bare number = length in feet (the report's standard lumber format).
  const lengthFt = parseInt(rawLen, 10);
  return {
    thickness, width,
    length_ft: lengthFt,
    board_feet: (thickness * width * lengthFt) / 12,
  };
}

// Patterns that flag dimensional lumber as MBF-priced even when the warehouse
// unit field reads MEA (a common mislabel — premium spruce, SPF, "& BTR"
// stock is traded in thousand-board-feet regardless of the unit code).
const LUMBER_DESC_PATTERNS = [
  /PREMIUM SPRUCE/i,
  /#\s*2\s*&\s*BTR/i,
  /STD\s*&\s*BTR/i,
  /SPF\s*KD/i,
  /SPF\s*\(PC\)/i,
  /PREMIUM SPF/i,
];

// Returns true if this row should be treated as MBF-priced and converted to
// per-piece. Triggers either on unit='MBF' or on a known dimensional-lumber
// description pattern.
export function needsMbfConversion(row) {
  const unit = (row.unit || '').toUpperCase();
  if (unit === 'MBF') return true;
  const desc = row.description || '';
  return LUMBER_DESC_PATTERNS.some((re) => re.test(desc));
}

// Sanity-check a converted per-piece price. Returns true if the price is
// suspicious (outside the $0.50–$500 band a single dimensional-lumber piece
// would normally fall into). The caller decides whether to log/skip.
export function isSuspiciousPerPiece(price) {
  if (price == null) return false;
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return false;
  return n < 0.5 || n > 500;
}

// Convert MBF (price per thousand board feet) → per-piece for a single row.
// Returns a new row with cost/price1..4 converted, plus is_mbf_converted=true.
// If dimensions can't be parsed or the row isn't lumber, returns the row with
// is_mbf_converted=false.
//
// onWarn(row, field, price) is invoked once per converted-but-suspicious price
// so the caller can log it.
export function maybeConvertMbf(row, onWarn) {
  if (!needsMbfConversion(row)) return { ...row, is_mbf_converted: false };
  const d = parseLumberDimensions(row.description);
  if (!d || !(d.board_feet > 0)) return { ...row, is_mbf_converted: false };
  const f = (mbfPrice) => mbfPrice == null ? null : (Number(mbfPrice) / 1000) * d.board_feet;
  const out = {
    ...row,
    cost: f(row.cost),
    price1: f(row.price1),
    price2: f(row.price2),
    price3: f(row.price3),
    price4: f(row.price4),
    is_mbf_converted: true,
  };
  if (onWarn) {
    for (const f of ['cost', 'price1', 'price2', 'price3', 'price4']) {
      if (isSuspiciousPerPiece(out[f])) onWarn(out, f, out[f]);
    }
  }
  return out;
}
