# SED Sales Dashboard — live on Azure, fed by Snowflake

A live version of the SED sales dashboard. The page (`index.html`) is served by **Azure Static Web Apps**;
on every open it calls `/api/data`, an **Azure Function** (`api/`) that queries the `SED_DB.PUBLIC` views in
Snowflake over key-pair auth and returns the nine datasets the page renders. GitHub Actions deploys the
site on every push to `main`. Sign-in is required (Microsoft account) and only invited users get in.

```
Browser ──> Static Web App (index.html)
               └── /api/data ──> Azure Function (Node 18) ──> Snowflake SQL REST API (key-pair JWT)
                                   cached 1 h in-process              SED_DB.PUBLIC.VW_BASE_SALES_V2_<year>
                                                                      VW_BASE_ITEMS_V2, VW_ALL_ACCOUNTS_V2
```

The numbers reproduce the Power BI model's rules exactly (reconciled to the cent on 11/6/2026):
CEs = cases × OZ_CASE ÷ 288 with bottle lines (unit id 0/3) excluded; GP = sales − discount − cost;
in-scope = items with a PQD; windows anchored on the last complete day of sales; last year = same calendar days.

## One-time setup (about 20 minutes)

### 1. Snowflake — register the public key (done as yourself, no admin)
```sql
ALTER USER HSOWDA SET RSA_PUBLIC_KEY = '<public key body>';
DESC USER HSOWDA;  -- RSA_PUBLIC_KEY_FP must equal the fingerprint you were given
```
The matching private key goes into Azure in step 3 and nowhere else.

### 2. GitHub — push this repo and add the secrets
Push these files to `main`. Then **Settings → Secrets and variables → Actions → New repository secret**, three times:

| Secret | Value |
|---|---|
| `SNOWFLAKE_ACCOUNT` | `TFVRURQ-BKB02018` |
| `SNOWFLAKE_USER` | `HUNTER.SOWDA@SILVEREAGLE.COM` (the LOGIN_NAME, not `HSOWDA`) |
| `SNOWFLAKE_PRIVATE_KEY` | contents of `rsa_key.p8`, including the BEGIN/END lines |

Azure adds a fourth secret (`AZURE_STATIC_WEB_APPS_API_TOKEN_…`) itself in step 3. Then **Actions → Refresh dashboard
data from Snowflake → Run workflow** to build the first `data.json` (about 2 minutes).
Do **not** commit `rsa_key.p8` or `api/local.settings.json` (both are in `.gitignore`).

### 3. Azure — create the Static Web App
Azure portal → **Create a resource** → **Static Web App**:
- Plan: **Free**
- Source: **GitHub** → sign in → pick the repo and `main`
- Build presets: **Custom**; App location `/`; Api location `api`; Output location *(leave empty)*
- Create. Azure adds a workflow file under `.github/workflows/` to the repo and runs the first deploy (2–4 min).

Then in the Static Web App → **Settings → Environment variables** (or *Configuration → Application settings*), add:

| Name | Value |
|---|---|
| `SNOWFLAKE_ACCOUNT` | `TFVRURQ-BKB02018` |
| `SNOWFLAKE_USER` | `HUNTER.SOWDA@SILVEREAGLE.COM` (the LOGIN_NAME) |
| `SNOWFLAKE_PRIVATE_KEY` | contents of `rsa_key.p8`, including the BEGIN/END lines (paste as-is; newlines are fine) |
| `SNOWFLAKE_ROLE` | `SED_PBI_ANALYST` |
| `SNOWFLAKE_WAREHOUSE` | `COMPUTE_WH` |
| `SNOWFLAKE_DATABASE` | `SED_DB` |
| `SNOWFLAKE_SCHEMA` | `PUBLIC` |
| `CACHE_SECONDS` | `3600` |

Save. `https://<your-app>.azurestaticapps.net/api/data` answers `{"status":"pending"}` while Snowflake runs and the
payload once it's done (~90 s); the page handles that polling itself.

### 4. Who can see it
`staticwebapp.config.json` requires the custom role **`sed`** on every route. To let someone in:
Static Web App → **Role management** → **Invite** → their email, role `sed`, expiry up to 7 days → send
them the invitation link. Up to 25 invitations on the Free plan. Nobody else — including signed-in
Microsoft users who weren't invited — sees anything but `no-access.html`.

To make it open to anyone with the link instead, change both `allowedRoles` entries to `["anonymous"]`.

## Day to day
- The page shows which build it's on (daily or live) and when it was queried; **refresh from Snowflake now** pulls live.
- The morning job runs Mon–Sat; run it by hand any time from the repo's **Actions** tab (**Run workflow**).
- Every push to `main` redeploys in a couple of minutes; the function and page deploy together.
- Cost: Static Web App Free plan = $0; GitHub Actions ≈ 3 min/day (free tier is 2,000 min/month);
  Snowflake = one ~90 s query per build on `COMPUTE_WH` (X-Small).

## Local run (optional)
```
cd api && npm install
cp local.settings.example.json local.settings.json   # fill in the private key
node test-connection.js                               # prints CURRENT_USER / ROLE and the last invoice date
```
Or `npm i -g @azure/static-web-apps-cli && swa start . --api-location api` to run the whole site at http://localhost:4280.

## Files
```
index.html                  the dashboard (D3); fetches /api/data, then renders
no-access.html              shown to signed-in users who weren't invited
staticwebapp.config.json    auth routes (Microsoft sign-in, role "sed"), API runtime
data.json                   the daily build (written by the refresh workflow; the page loads it first)
api/data/index.js           GET /api/data — submits the query async, 202 while running, 200 with the payload
api/lib/snowflake.js        SQL REST API client with key-pair JWT (no SDK): runSql, submit, check
api/lib/sql.js              the model's rules as one SQL statement (grouping sets; windows computed in SQL)
api/lib/build.js            datasets from the result rows (windows, YTD/MTD, daily, dims)
api/test-connection.js      smoke test
scripts/build-data.js       what the refresh workflow runs: query → data.json
.github/workflows/refresh-data.yml   the 6:15 AM job (and Run workflow button)
```
