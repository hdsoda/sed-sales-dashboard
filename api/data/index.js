// GET /api/data — live dashboard datasets from Snowflake. Cached in-process for CACHE_SECONDS (default 1 h):
// the views load once a night, so a longer cache only saves warehouse credits.
const { runSql } = require('../lib/snowflake');
const { dailyPqdSql, dimsSql } = require('../lib/sql');
const { windowsFrom, buildFromDaily, buildFromDims } = require('../lib/build');

let cache = { at: 0, body: null, inflight: null };
const CACHE_MS = (Number(process.env.CACHE_SECONDS) || 3600) * 1000;

function todayHouston() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value; return `${g('year')}-${g('month')}-${g('day')}`;
}

async function build() {
  const today = todayHouston();
  const years = [+today.slice(0, 4) - 1, +today.slice(0, 4)];
  const t0 = Date.now();
  const daily = (await runSql(dailyPqdSql(years))).rows;
  const W = windowsFrom(daily, today);
  const dims = (await runSql(dimsSql(years, W))).rows;
  return {
    meta: { queried_at: new Date().toISOString(), query_ms: Date.now() - t0, today, years, cache_seconds: CACHE_MS / 1000 },
    windows: [W], ...buildFromDaily(daily, W), ...buildFromDims(dims),
  };
}

module.exports = async function (context, req) {
  const force = req.query && req.query.refresh === '1';
  try {
    if (!force && cache.body && Date.now() - cache.at < CACHE_MS) {
      context.res = { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300', 'X-Cache': 'hit' }, body: cache.body };
      return;
    }
    if (!cache.inflight) cache.inflight = build().finally(() => { cache.inflight = null; });
    const body = await cache.inflight;
    cache = { ...cache, at: Date.now(), body };
    context.res = { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300', 'X-Cache': 'miss' }, body };
  } catch (e) {
    context.log.error(e);
    context.res = { status: 502, headers: { 'Content-Type': 'application/json' }, body: { error: String(e.message || e) } };
  }
};
