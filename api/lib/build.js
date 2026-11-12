// Builds the nine dashboard datasets from the two Snowflake result sets.
// Port of the Python build that was reconciled to the Power BI model (11/6/2026).

const HOLIDAYS = new Set(['2025-01-01', '2025-05-26', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-05-25', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-05-31', '2027-09-06', '2027-11-25', '2027-12-24']);

const SEGMENT_MAP = {
  'ADULT ENTERTAIN': 'ON-PREMISE', 'AIRLINE TERMINA': 'ON-PREMISE', 'ALTERNATIVE LIF': 'ON-PREMISE', 'BANQUET/CATERER': 'ON-PREMISE',
  'BAR': 'ON-PREMISE', 'BAR/TAV/ GROUP': 'ON-PREMISE', 'BARBECUE REST': 'ON-PREMISE', 'BEAUTY/SPA/TAN': 'ON-PREMISE',
  'BILL TO NUMBERS': 'NON-RETAIL', 'BOWLING ALLEY': 'ON-PREMISE', 'BRANCH TRANSFER': 'NON-RETAIL', 'BTAX WHOLESALER': 'NON-RETAIL',
  'CASINO': 'ON-PREMISE', 'CC/GOLF/PRIVATE': 'ON-PREMISE', 'CHAIN RESTAURAN': 'ON-PREMISE', 'CHINESE REST': 'ON-PREMISE',
  'CHURCH': 'ON-PREMISE', 'COCKTAIL LOUNGE': 'ON-PREMISE', 'COFFEE HOUSE': 'ON-PREMISE', 'COLLEGE BAR': 'ON-PREMISE',
  'CONSESSIONAIRE': 'ON-PREMISE', 'CONV CHAIN': 'CHAIN C-STORE', 'CONV DRIVE THRU': 'INDY C-STORE', 'CONV INDY': 'INDY C-STORE',
  'CONV INDY TOP': 'INDY C-STORE', 'COUNTRY/WESTERN': 'ON-PREMISE', 'DANCE HALL': 'ON-PREMISE', 'DISCOUNT STORE': 'OTHER',
  'DRUG STORE': 'DRUG', 'E COMMERCE': 'OTHER', 'EATING PLACES': 'ON-PREMISE', 'ETHNIC REST OTH': 'ON-PREMISE', 'FOOD KIOSK': 'ON-PREMISE',
  'FRENCH REST': 'ON-PREMISE', 'GOLF PUBLIC': 'ON-PREMISE', 'GROCERY CHAIN': 'GROCERY', 'GROCERY CLUB': 'GROCERY', 'GROCERY INDY': 'GROCERY',
  'GROCERY SPECIAL': 'GROCERY', 'ICE HOUSE': 'ON-PREMISE', 'INDEP RESTAURAN': 'ON-PREMISE', 'INDIAN REST': 'ON-PREMISE', 'IRISH PUB': 'ON-PREMISE',
  'ITALIAN REST': 'ON-PREMISE', 'JAPANESE REST': 'ON-PREMISE', 'KOREAN REST': 'ON-PREMISE', 'LIQUOR CHAIN': 'LIQUOR', 'LIQUOR INDY': 'LIQUOR',
  'LODGING (HOTEL)': 'ON-PREMISE', 'MARINA/LAKE': 'ON-PREMISE', 'MEAT MKT CHAIN': 'OTHER', 'MEAT MKT INDY': 'OTHER', 'MEXICAN REST': 'ON-PREMISE',
  'MILITARY OFF': 'OTHER', 'MUSIC VENUE': 'ON-PREMISE', 'NIGHTCLUB/DISCO': 'ON-PREMISE', 'NON RETAIL': 'NON-RETAIL', 'OTH HISP REST': 'ON-PREMISE',
  'OTHER OFF PREM': 'OTHER', 'OTHER ON PREM': 'ON-PREMISE', 'PIZZA': 'ON-PREMISE', 'POOL HALL': 'ON-PREMISE', 'PRIVATE CLUBS': 'ON-PREMISE',
  'RACE TRACK': 'ON-PREMISE', 'RESTAURANT/BAR': 'ON-PREMISE', 'SERVICE ORGANIZ': 'ON-PREMISE', 'SPORTS BAR': 'ON-PREMISE', 'SPORTS/REC CLUB': 'ON-PREMISE',
  'STADIUM/ARENA': 'ON-PREMISE', 'TAVERN': 'ON-PREMISE', 'THAI REST': 'ON-PREMISE', 'THEATER': 'ON-PREMISE', 'THEME PARK': 'ON-PREMISE',
  'VENDING MACHINE': 'ON-PREMISE', 'VIETNAMESE REST': 'ON-PREMISE', 'XFER CONROE': 'NON-RETAIL', 'XFER CYPRESS': 'NON-RETAIL',
  'XFER HOUSTON': 'NON-RETAIL', 'XFER OTHER DIST': 'NON-RETAIL', 'XFER ROSENBERG': 'NON-RETAIL',
};
const SEGMENT_SORT = { 'INDY C-STORE': 1, 'CHAIN C-STORE': 2, 'GROCERY': 3, 'LIQUOR': 4, 'DRUG': 5, 'OTHER': 6, 'ON-PREMISE': 7, 'NON-RETAIL': 8 };
const STOP = new Set(['LLC', 'INC', 'CO', 'COMPANY', 'COMP', 'BRANDS', 'BREWING', 'BOTTLING', 'BEVERAGE', 'BEV', 'GROUP', 'WATER', 'USA', 'PROJECTS', 'SPARKLING', 'TEA']);
const SUP_OVER = [['KING JUICE', 'KING JUICE'], ['ARIZONA', 'ARIZONA'], ['SAPPORO STONE', 'SAPPORO'], ['NIAGARA', 'NIAGARA']];
const CHAIN_OVER = [['HEB', 'HEB'], ['KROGER', 'KROGER'], ['WALMART', 'WALMART'], ['WAL MART', 'WALMART'], ['SAMS', "SAM'S CLUB"], ['SPECS', "SPEC'S"],
  ['CVS', 'CVS'], ['FIESTA', 'FIESTA'], ['DOLLAR GEN', 'DOLLAR GENERAL'], ['FAM DOLLAR', 'FAMILY DOLLAR'], ['MRT', 'MRT'], ['CIR K CRP', 'CIRCLE K'],
  ['TIMEWISE F', 'TIMEWISE'], ['SPRG PRT F', 'HONEY FARMS'], ['LA MICHOA', 'LA MICHOACANA'], ['SELLER BRO', 'SELLERS BROS'], ['WALNEIGHMK', 'WALMART NBHD MKT']];

function supplierShort(name) {
  if (name == null) return '';
  const n = String(name).replace(/[.,]/g, '').trim().toUpperCase();
  for (const [pre, out] of SUP_OVER) if (n.startsWith(pre)) return out;
  const words = n.split(' ').filter(Boolean);
  let kept = [...words];
  while (kept.length > 1 && STOP.has(kept[kept.length - 1])) kept = kept.slice(0, -1);
  return (kept.length ? kept : words).join(' ');
}
function chainShort(chain) {
  const raw = chain == null ? '' : String(chain).trim().toUpperCase();
  if (raw === '') return 'INDEPENDENT';
  const tail = raw.length > 4 ? raw.slice(-4) : '';
  const base = tail && /^\d{4}$/.test(tail) ? raw.slice(0, -4).trim() : raw;
  for (const [pre, out] of CHAIN_OVER) if (base.startsWith(pre)) return out;
  return base;
}
const chainName = (c) => (c == null || String(c).trim() === '' ? 'INDEPENDENT (no chain)' : String(c));

// ---- dates (all as 'YYYY-MM-DD' strings; arithmetic in UTC to avoid DST surprises)
const toD = (s) => new Date(s + 'T00:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(toD(s).getTime() + n * 86400000));
const ymd = (y, m, d) => iso(new Date(Date.UTC(y, m - 1, d)));
function minus12Months(s) { const d = toD(s); const y = d.getUTCFullYear() - 1, m = d.getUTCMonth() + 1, day = d.getUTCDate(); return (m === 2 && day === 29) ? ymd(y, 2, 28) : ymd(y, m, day); }
function sellingDays(a, b) { let n = 0; for (let s = a; s <= b; s = addDays(s, 1)) { const wd = toD(s).getUTCDay(); if (wd >= 1 && wd <= 5 && !HOLIDAYS.has(s)) n++; } return n; }
const r2 = (v) => String(Math.round((Number(v) || 0) * 100) / 100);

/** today: 'YYYY-MM-DD' in Houston. daily: rows {D, WH, PQD, CE, GP}. */
function windowsFrom(daily, today) {
  const dates = daily.map((r) => r.D).filter((d) => d < today);
  if (!dates.length) throw new Error('No sales before today in the views');
  const lcd = dates.reduce((a, b) => (a > b ? a : b));
  const y = +lcd.slice(0, 4), m = +lcd.slice(5, 7);
  const py_end = minus12Months(lcd); const py = +py_end.slice(0, 4), pm = +py_end.slice(5, 7);
  const w = { as_of: lcd, ytd_start: ymd(y, 1, 1), ytd_end: lcd, py_ytd_start: ymd(py, 1, 1), py_ytd_end: py_end,
    mtd_start: ymd(y, m, 1), mtd_end: lcd, py_mtd_start: ymd(py, pm, 1), py_mtd_end: py_end };
  w.selling_days_ytd = String(sellingDays(w.ytd_start, w.ytd_end)); w.selling_days_py_ytd = String(sellingDays(w.py_ytd_start, w.py_ytd_end));
  w.selling_days_mtd = String(sellingDays(w.mtd_start, w.mtd_end)); w.selling_days_py_mtd = String(sellingDays(w.py_mtd_start, w.py_mtd_end));
  return w;
}

function sumBy(rows, keyFn, pick) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (k === null) continue; let o = m.get(k); if (!o) { o = { ...pick(r), ce: 0, gp: 0 }; m.set(k, o); } o.ce += Number(r.CE) || 0; o.gp += Number(r.GP) || 0; }
  return [...m.values()];
}
function tyLy(rows, keys, ty, ly) {
  const inW = (d, w) => d >= w[0] && d <= w[1];
  const m = new Map();
  for (const r of rows) {
    const t = inW(r.D, ty), l = inW(r.D, ly); if (!t && !l) continue;
    const k = keys.map((f) => r[f]).join('|'); let o = m.get(k);
    if (!o) { o = {}; for (const f of keys) o[f.toLowerCase()] = r[f] == null ? '' : String(r[f]); o.ce_ty = 0; o.gp_ty = 0; o.ce_ly = 0; o.gp_ly = 0; m.set(k, o); }
    if (t) { o.ce_ty += +r.CE || 0; o.gp_ty += +r.GP || 0; } if (l) { o.ce_ly += +r.CE || 0; o.gp_ly += +r.GP || 0; }
  }
  return [...m.values()].map((o) => ({ ...o, ce_ty: r2(o.ce_ty), gp_ty: r2(o.gp_ty), ce_ly: r2(o.ce_ly), gp_ly: r2(o.gp_ly) }));
}

function buildFromDaily(daily, W) {
  const ytd_pqd = tyLy(daily, ['PQD', 'WH'], [W.ytd_start, W.ytd_end], [W.py_ytd_start, W.py_ytd_end]);
  const mtd_pqd = tyLy(daily, ['PQD', 'WH'], [W.mtd_start, W.mtd_end], [W.py_mtd_start, W.py_mtd_end]);
  const lcdYear = +W.as_of.slice(0, 4);
  const monthly_pqd = sumBy(daily.filter((r) => +r.D.slice(0, 4) >= lcdYear - 1), (r) => `${r.PQD}|${r.WH}|${r.D.slice(0, 7)}`,
    (r) => ({ pqd: r.PQD, wh: r.WH, year: r.D.slice(0, 4), month: String(+r.D.slice(5, 7)) })).map((o) => ({ ...o, ce: r2(o.ce), gp: r2(o.gp) }));
  const byDay = new Map(); for (const r of daily) { const k = r.D + '|' + r.WH; const o = byDay.get(k) || { ce: 0, gp: 0 }; o.ce += +r.CE || 0; o.gp += +r.GP || 0; byDay.set(k, o); }
  const mtd_daily = [];
  const y = +W.as_of.slice(0, 4), m = +W.as_of.slice(5, 7); const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= lastDay; d++) {
    const dt = ymd(y, m, d), ly = addDays(dt, -364);
    for (const wh of ['4', '6']) {
      const t = byDay.get(dt + '|' + wh), l = byDay.get(ly + '|' + wh), open = dt <= W.as_of;
      mtd_daily.push({ day: String(d), date_ty: dt, date_ly: ly, wh, ce_ty: open ? r2(t ? t.ce : 0) : '', gp_ty: open ? r2(t ? t.gp : 0) : '', ce_ly: r2(l ? l.ce : 0), gp_ly: r2(l ? l.gp : 0) });
    }
  }
  return { ytd_pqd, mtd_pqd, monthly_pqd, mtd_daily };
}

function buildFromDims(dims) {
  const agg = (keyFn, pick) => {
    const m = new Map();
    for (const r of dims) { const k = keyFn(r); let o = m.get(k); if (!o) { o = { ...pick(r), ce_ty: 0, gp_ty: 0, ce_ly: 0, gp_ly: 0 }; m.set(k, o); }
      o.ce_ty += +r.CE_TY || 0; o.gp_ty += +r.GP_TY || 0; o.ce_ly += +r.CE_LY || 0; o.gp_ly += +r.GP_LY || 0; }
    return [...m.values()].filter((o) => o.ce_ty || o.ce_ly || o.gp_ty || o.gp_ly).map((o) => ({ ...o, ce_ty: r2(o.ce_ty), gp_ty: r2(o.gp_ty), ce_ly: r2(o.ce_ly), gp_ly: r2(o.gp_ly) }));
  };
  const ytd_supplier = agg((r) => supplierShort(r.SUPPLIER_NAME) + '|' + r.WH, (r) => ({ supplier: supplierShort(r.SUPPLIER_NAME), wh: r.WH }));
  const ytd_brand_family = agg((r) => (r.BRAND_FAMILY ?? '') + '|' + r.WH, (r) => ({ brand_family: r.BRAND_FAMILY ?? '', wh: r.WH }));
  const ytd_segment = agg((r) => (SEGMENT_MAP[r.COT] ?? '') + '|' + r.WH, (r) => { const s = SEGMENT_MAP[r.COT] ?? ''; return { segment: s, segment_sort: String(SEGMENT_SORT[s] ?? 99), wh: r.WH }; });
  const ytd_chain = agg((r) => chainName(r.CHAIN) + '|' + r.WH, (r) => ({ chain_name: chainName(r.CHAIN), chain: chainShort(r.CHAIN), is_chain: String(!chainName(r.CHAIN).includes('INDEPENDENT')), wh: r.WH }));
  return { ytd_supplier, ytd_brand_family, ytd_segment, ytd_chain };
}

/** Full payload from the single-statement result rows. */
function buildPayload(rows, today, meta = {}) {
  const { splitRows } = require('./sql');
  const { daily, dims } = splitRows(rows);
  const W = windowsFrom(daily, today);
  return { meta: { queried_at: new Date().toISOString(), today, ...meta }, windows: [W], ...buildFromDaily(daily, W), ...buildFromDims(dims) };
}

module.exports = { windowsFrom, buildFromDaily, buildFromDims, buildPayload, supplierShort, chainShort };
