// Smoke test: node api/test-connection.js   (reads the same env vars the Function uses; or a local.settings.json)
const fs = require('fs'), path = require('path');
const ls = path.join(__dirname, 'local.settings.json');
if (fs.existsSync(ls)) Object.assign(process.env, JSON.parse(fs.readFileSync(ls)).Values || {});
const { runSql } = require('./lib/snowflake');
(async () => {
  const t0 = Date.now();
  const r = await runSql("SELECT CURRENT_USER() AS U, CURRENT_ROLE() AS R, CURRENT_WAREHOUSE() AS W, CURRENT_ACCOUNT() AS A");
  console.log('connected:', r.rows[0], `${Date.now() - t0} ms`);
  const v = await runSql("SELECT MAX(INVOICE_DATE)::DATE AS LAST_INVOICE, COUNT(*) AS ROWS_2026 FROM SED_DB.PUBLIC.VW_BASE_SALES_V2_2026 WHERE RECORD_STATUS = 'A'");
  console.log('sales view:', v.rows[0]);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
