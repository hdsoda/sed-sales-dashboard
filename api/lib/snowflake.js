// Snowflake SQL REST API client with key-pair (JWT) auth. No Snowflake SDK needed.
// Env: SNOWFLAKE_ACCOUNT (e.g. TFVRURQ-BKB02018), SNOWFLAKE_USER, SNOWFLAKE_PRIVATE_KEY (PEM, PKCS8),
//      SNOWFLAKE_ROLE, SNOWFLAKE_WAREHOUSE, SNOWFLAKE_DATABASE, SNOWFLAKE_SCHEMA
const crypto = require('crypto');
const jwt = require('jsonwebtoken');


/** Rebuild a PKCS8 PEM from however the key was pasted: real newlines, literal "\n", one long line, or bare base64. */
function normalizePem(raw) {
  let s = String(raw).trim().replace(/\\n/g, '\n').replace(/^["']|["']$/g, '');
  s = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, '').replace(/-----END [A-Z ]*PRIVATE KEY-----/g, '');
  const b64 = s.replace(/[^A-Za-z0-9+/=]/g, '');
  if (!b64) throw new Error('SNOWFLAKE_PRIVATE_KEY is empty');
  return '-----BEGIN PRIVATE KEY-----\n' + b64.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
}

function cfg() {
  const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing app setting ${k}`); return v; };
  return {
    account: need('SNOWFLAKE_ACCOUNT').toUpperCase(),
    user: need('SNOWFLAKE_USER').toUpperCase(),
    key: normalizePem(need('SNOWFLAKE_PRIVATE_KEY')),
    role: process.env.SNOWFLAKE_ROLE || 'SED_PBI_ANALYST',
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'COMPUTE_WH',
    database: process.env.SNOWFLAKE_DATABASE || 'SED_DB',
    schema: process.env.SNOWFLAKE_SCHEMA || 'PUBLIC',
    host: process.env.SNOWFLAKE_HOST || `${need('SNOWFLAKE_ACCOUNT').toLowerCase()}.snowflakecomputing.com`,
  };
}

function makeJwt(c) {
  const pub = crypto.createPublicKey(c.key).export({ type: 'spki', format: 'der' });
  const fp = 'SHA256:' + crypto.createHash('sha256').update(pub).digest('base64');
  const qualified = `${c.account}.${c.user}`;
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: `${qualified}.${fp}`, sub: qualified, iat: now, exp: now + 59 * 60 }, c.key, { algorithm: 'RS256' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(c, token, path, opts = {}) {
  const r = await fetch(`https://${c.host}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}`,
               'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT', 'User-Agent': 'sed-dashboard/1.0', ...(opts.headers || {}) },
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { message: text }; }
  if (!r.ok && r.status !== 202) throw new Error(`Snowflake ${r.status}${body.code ? " [" + body.code + "]" : ""}: ${body.message || text}`);
  return { status: r.status, body };
}

function statementBody(c, statement, timeout) {
  return JSON.stringify({ statement, timeout, role: c.role, warehouse: c.warehouse, database: c.database, schema: c.schema,
                          parameters: { TIMEZONE: 'America/Chicago', DATE_OUTPUT_FORMAT: 'YYYY-MM-DD' } });
}

function collect(body) {
  const columns = body.resultSetMetaData.rowType.map((t) => t.name);
  return { columns, parts: body.resultSetMetaData.partitionInfo || [], first: body.data || [] };
}

async function allRows(c, token, handle, body) {
  const { columns, parts, first } = collect(body);
  const rows = [...first];
  for (let p = 1; p < parts.length; p++) {
    const more = await call(c, token, `/api/v2/statements/${handle}?partition=${p}`);
    rows.push(...(more.body.data || []));
  }
  return { columns, rows: rows.map((r) => Object.fromEntries(r.map((v, i) => [columns[i], v]))) };
}

/** Submit a statement without waiting; returns the statement handle. Snowflake runs it to completion on its own. */
async function submit(statement, { timeout = 600 } = {}) {
  const c = cfg(); const token = makeJwt(c);
  const { body } = await call(c, token, '/api/v2/statements?async=true', { method: 'POST', body: statementBody(c, statement, timeout) });
  if (!body.statementHandle) throw new Error(`Snowflake did not return a statement handle: ${JSON.stringify(body).slice(0, 300)}`);
  return body.statementHandle;
}

/** Check a submitted statement: {done:false} while running, {done:true, columns, rows} when finished. Throws if it failed. */
async function check(handle) {
  const c = cfg(); const token = makeJwt(c);
  const { status, body } = await call(c, token, `/api/v2/statements/${handle}`);
  if (status === 202 || body.code === '333334') return { done: false, message: body.message };
  if (!body.resultSetMetaData) throw new Error(`Snowflake statement ${handle} failed: ${body.message || JSON.stringify(body).slice(0, 300)}`);
  return { done: true, ...(await allRows(c, token, handle, body)) };
}

/** Run one statement and wait for it (polls); returns {columns, rows} with every partition collected. */
async function runSql(statement, { timeout = 600 } = {}) {
  const c = cfg(); const token = makeJwt(c);
  let { status, body } = await call(c, token, '/api/v2/statements', { method: 'POST', body: statementBody(c, statement, Math.min(timeout, 170)) });
  const handle = body.statementHandle;
  let waited = 0;
  while (status === 202 || body.code === '333334') {
    await sleep(2000); waited += 2;
    if (waited > timeout) throw new Error('Snowflake query timed out');
    ({ status, body } = await call(c, token, `/api/v2/statements/${handle}`));
  }
  if (!body.resultSetMetaData) throw new Error(`Unexpected Snowflake response: ${JSON.stringify(body).slice(0, 300)}`);
  return allRows(c, token, handle, body);
}

module.exports = { runSql, submit, check, cfg };
