// GET /api/data — live datasets from Snowflake, built in the background.
//   200 + payload   when a fresh build is available (in-process cache, CACHE_SECONDS)
//   202 + {pending} while the Snowflake statement is running — the page polls until it gets a 200
// Azure's managed functions cap a request at 45 s and the query takes ~90 s, so the function never waits
// on Snowflake: it submits the statement asynchronously and checks it on each poll. The in-process cache is
// best effort (a cold start forgets it); the durable daily copy is data.json, written by the refresh workflow.
const { submit, check } = require('../lib/snowflake');
const { dashboardSql } = require('../lib/sql');
const { buildPayload } = require('../lib/build');

const CACHE_MS = (Number(process.env.CACHE_SECONDS) || 3600) * 1000;
let state = { payload: null, builtAt: 0, pending: null };   // pending: {handle, startedAt, today}

function todayHouston() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value; return `${g('year')}-${g('month')}-${g('day')}`;
}
const json = (status, body, extra = {}) => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }, body });

module.exports = async function (context, req) {
  const force = req.query && req.query.refresh === '1';
  try {
    if (!force && state.payload && Date.now() - state.builtAt < CACHE_MS) return (context.res = json(200, state.payload, { 'X-Cache': 'hit' }));
    const today = todayHouston();
    if (state.pending) {
      const r = await check(state.pending.handle);
      if (!r.done) return (context.res = json(202, { status: 'pending', elapsed_s: Math.round((Date.now() - state.pending.startedAt) / 1000), handle: state.pending.handle }));
      const payload = buildPayload(r.rows, state.pending.today, { query_ms: Date.now() - state.pending.startedAt, source: 'live', cache_seconds: CACHE_MS / 1000 });
      state = { payload, builtAt: Date.now(), pending: null };
      return (context.res = json(200, payload, { 'X-Cache': 'miss' }));
    }
    const years = [+today.slice(0, 4) - 1, +today.slice(0, 4)];
    const handle = await submit(dashboardSql(years, today));
    state.pending = { handle, startedAt: Date.now(), today };
    return (context.res = json(202, { status: 'pending', elapsed_s: 0, handle }));
  } catch (e) {
    context.log.error(e);
    state.pending = null;
    context.res = json(502, { error: String(e.message || e) });
  }
};
