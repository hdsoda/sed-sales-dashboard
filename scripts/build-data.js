// Builds data.json from Snowflake. Run by the refresh workflow every morning (and by hand: node scripts/build-data.js).
// Needs SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PRIVATE_KEY (+ optional ROLE/WAREHOUSE/DATABASE/SCHEMA) in the environment.
const fs = require('fs'), path = require('path');
const { runSql } = require('../api/lib/snowflake');
const { dashboardSql } = require('../api/lib/sql');
const { buildPayload } = require('../api/lib/build');

function todayHouston() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value; return `${g('year')}-${g('month')}-${g('day')}`;
}

(async () => {
  const today = todayHouston();
  const years = [+today.slice(0, 4) - 1, +today.slice(0, 4)];
  const t0 = Date.now();
  const { rows } = await runSql(dashboardSql(years, today), { timeout: 900 });
  const payload = buildPayload(rows, today, { query_ms: Date.now() - t0, source: 'scheduled' });
  const out = path.join(__dirname, '..', 'data.json');
  fs.writeFileSync(out, JSON.stringify(payload));
  console.log(`data.json: as of ${payload.windows[0].as_of}, ${rows.length} rows, ${Math.round((Date.now() - t0) / 1000)} s, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
