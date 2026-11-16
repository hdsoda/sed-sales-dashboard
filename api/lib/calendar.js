// Selling-day calendar shared by the SQL (window end) and the builder (selling-day counts).
// A selling day is a weekday that is not a company holiday. The dashboard's "last complete day"
// is the latest selling day with invoices before today, so a few weekend invoices (or a partial
// load dated to a weekend) never become the window end or the last point of the daily chart.
const HOLIDAYS = ['2025-01-01', '2025-05-26', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-05-25', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-05-31', '2027-09-06', '2027-11-25', '2027-12-24'];
const HOLIDAY_SET = new Set(HOLIDAYS);
/** 'YYYY-MM-DD' -> true for Mon–Fri that is not a holiday */
function isSellingDay(s) { const wd = new Date(s + 'T00:00:00Z').getUTCDay(); return wd >= 1 && wd <= 5 && !HOLIDAY_SET.has(s); }
module.exports = { HOLIDAYS, HOLIDAY_SET, isSellingDay };
