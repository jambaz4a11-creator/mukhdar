// منطق نقي لسكربت شجرة العناوين (اختباره بـ lib.test.mjs): التحقق من data.json وتصنيف العناوين القديمة.
const FLOOR_MIN = 0;
const FLOOR_MAX = 9;
const APARTMENT_MIN = 1;
const APARTMENT_MAX = 12;

/** يتحقق من بنية data.json ويرمي بالسبب. يرجع البيانات نفسها. */
export function validateData(data) {
  if (!data || typeof data !== 'object') throw new Error('data.json: not an object');
  if (typeof data.city !== 'string' || !data.city) throw new Error('data.json: city is missing');
  if (!Array.isArray(data.blocks) || data.blocks.length === 0) {
    throw new Error('data.json: blocks must be a non-empty array');
  }
  const seen = new Set();
  for (const b of data.blocks) {
    if (typeof b.sector !== 'string' || !b.sector)
      throw new Error('data.json: block without sector');
    if (typeof b.name !== 'string' || !/^[A-Z][0-9]$/.test(b.name)) {
      throw new Error(`data.json: bad block name ${JSON.stringify(b.name)}`);
    }
    if (seen.has(b.name)) throw new Error(`data.json: duplicate block ${b.name}`);
    seen.add(b.name);
    // مطابقة حرف القطاع: "قطاع A" ← A1..A9
    if (!b.sector.endsWith(b.name[0])) {
      throw new Error(`data.json: block ${b.name} does not belong to ${b.sector}`);
    }
    // رقم العمارة بقاعدة البيانات 1..100 (buildings_number_format)
    if (!Number.isInteger(b.buildings) || b.buildings < 1 || b.buildings > 100) {
      throw new Error(`data.json: block ${b.name} buildings must be an integer 1..100`);
    }
  }
  if (data.floors?.min !== FLOOR_MIN || data.floors?.max !== FLOOR_MAX) {
    throw new Error(`data.json: floors must be ${FLOOR_MIN}..${FLOOR_MAX} (matches the database)`);
  }
  if (data.apartments?.min !== APARTMENT_MIN || data.apartments?.max !== APARTMENT_MAX) {
    throw new Error(
      `data.json: apartments must be ${APARTMENT_MIN}..${APARTMENT_MAX} (matches the database)`,
    );
  }
  return data;
}

/** أرقام العمارات 1..n كنصوص. */
export const buildingNumbers = (n) => Array.from({ length: n }, (_, i) => String(i + 1));

/** أسماء القطاعات المطلوب إظهارها (بترتيب أول ظهور). */
export function wantedSectors(data) {
  return [...new Set(data.blocks.map((b) => b.sector))];
}

/**
 * أسباب عدم صلاحية عنوان محفوظ بعد تطبيق الشجرة (فارغ = صالح).
 * a: { floor, apartment, building_active, block_active, sector_active }
 */
export function addressProblems(a) {
  const problems = [];
  if (a.floor === null || a.floor === undefined) problems.push('floor missing');
  else if (!Number.isInteger(a.floor) || a.floor < FLOOR_MIN || a.floor > FLOOR_MAX) {
    problems.push(`floor ${a.floor} outside G..9`);
  }
  const apt = String(a.apartment ?? '').trim();
  const n = Number(apt);
  if (!/^[1-9][0-9]?$/.test(apt) || n < APARTMENT_MIN || n > APARTMENT_MAX) {
    problems.push(`apartment "${apt}" outside 1..12`);
  }
  if (!a.sector_active || !a.block_active) problems.push('block hidden');
  else if (!a.building_active) problems.push('building not in block');
  return problems;
}
