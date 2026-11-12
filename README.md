# SED Sales Dashboard — live on Azure, fed by Snowflake

A live version of the SED sales dashboard. The page (`index.html`) is served by **Azure Static Web Apps**;
on every open it calls `/api/data`, an **Azure Function** (`api/`) that queries the `SED_DB.PUBLIC` views in
Snowflake over key-pair auth and returns the nine datasets the page renders. GitHub Actions deploys the
site on every push to `main`. The site is open to anyone with the link (sign-in can be switched on; see step 4).

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

### 2. GitHub — push this repo
Create an empty repo (for example `sed-sales-dashboard`) and push these files to `main`.
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
| `SNOWFLAKE_USER` | `HSOWDA` |
| `SNOWFLAKE_PRIVATE_KEY` | contents of `rsa_key.p8`, including the BEGIN/END lines (paste as-is; newlines are fine) |
| `SNOWFLAKE_ROLE` | `SED_PBI_ANALYST` |
| `SNOWFLAKE_WAREHOUSE` | `COMPUTE_WH` |
| `SNOWFLAKE_DATABASE` | `SED_DB` |
| `SNOWFLAKE_SCHEMA` | `PUBLIC` |
| `CACHE_SECONDS` | `3600` |

Save. Open `https://<your-app>.azurestaticapps.net/api/data` — the first call takes 10–30 s (Snowflake
scans the two sales views on an X-Small warehouse), later calls are instant for an hour.

### 4. Who can see it
The site is open: anyone with the URL can view it (no sign-in). To restrict it to invited people instead,
change both `allowedRoles` entries in `staticwebapp.config.json` to `["sed"]`, add
`"responseOverrides": { "401": { "redirect": "/.auth/login/aad?post_login_redirect_uri=.referrer", "statusCode": 302 } }`,
and invite viewers under the Static Web App's **Role management** with role `sed`.

## Day to day
- The page shows when the data was queried and offers **refresh now** (`?refresh=1`) to bypass the cache.
- Every push to `main` redeploys in a couple of minutes; the function and page deploy together.
- Snowflake loads invoices once a night, so an hour of caching costs nothing in freshness.
- Cost: Static Web App Free plan = $0; Snowflake = two short queries per cache miss on `COMPUTE_WH`.

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
staticwebapp.config.json    routes (open to anonymous), API runtime
api/data/index.js           GET /api/data — runs the two queries, builds datasets, caches 1 h
api/lib/snowflake.js        SQL REST API client with key-pair JWT (no SDK)
api/lib/sql.js              the model's rules as SQL (same CTE as the Streamlit port)
api/lib/build.js            datasets from the result sets (windows, YTD/MTD, daily, dims)
api/test-connection.js      smoke test
```
