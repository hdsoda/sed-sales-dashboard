// The model's rules, in SQL. One statement, one scan of the sales views, two grouping sets:
//   G = 0  → daily rows   (D, WH, PQD)                        → windows, YTD/MTD by PQD, monthly trend, daily chart
//   G = 1  → dim rows     (WH, SUPPLIER_NAME, BRAND_FAMILY, COT, CHAIN) with YTD / PY-YTD sums → supplier, brand, segment, chain
// Windows are computed in SQL from the last complete day (latest invoiced day before `today`).
const DB = () => `${process.env.SNOWFLAKE_DATABASE || 'SED_DB'}.${process.env.SNOWFLAKE_SCHEMA || 'PUBLIC'}`;

function dashboardSql(years, today) {
  const union = years.map((y) =>
    `      SELECT INVOICE_DATE, ACCOUNT_CODE, ITEM_CODE, INVOICE_QTY, PRODUCT_SALES, PRODUCT_COST, INVOICE_DISCOUNT, INVOICE_VIP_UNIT_ID
      FROM ${DB()}.VW_BASE_SALES_V2_${y} WHERE RECORD_STATUS = 'A'`).join('\n      UNION ALL\n');
  return `
    WITH items AS (
      SELECT ITEM_CODE, SUPPLIER_NAME, BRAND_NAME AS BRAND_FAMILY, ITEM_CUSTOM_LABEL_3 AS PQD, OZ_CASE
      FROM ${DB()}.VW_BASE_ITEMS_V2
      WHERE RECORD_STATUS = 'A' AND (ROW_EXPIRATION_DATE IS NULL OR ROW_EXPIRATION_DATE::DATE >= '${today}')
        AND ITEM_CUSTOM_LABEL_3 IS NOT NULL AND ITEM_CUSTOM_LABEL_3 <> ''
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ITEM_CODE ORDER BY ROW_EXPIRATION_DATE DESC NULLS FIRST) = 1
    ),
    accts AS (
      SELECT ACCOUNT_CODE, WAREHOUSE_CODE, CHAIN, COT
      FROM ${DB()}.VW_ALL_ACCOUNTS_V2
      WHERE RECORD_STATUS = 'A' AND (ROW_EXPIRATION_DATE IS NULL OR ROW_EXPIRATION_DATE::DATE >= '${today}')
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_CODE ORDER BY ROW_EXPIRATION_DATE DESC NULLS FIRST) = 1
    ),
    sales AS (
${union}
    ),
    f AS (
      SELECT s.INVOICE_DATE::DATE AS D, a.WAREHOUSE_CODE::VARCHAR AS WH, i.PQD, i.SUPPLIER_NAME, i.BRAND_FAMILY, a.COT, a.CHAIN,
             (CASE WHEN s.INVOICE_VIP_UNIT_ID IN (0, 3) THEN 0 ELSE s.INVOICE_QTY END) * i.OZ_CASE / 288.0 AS CE,
             s.PRODUCT_SALES - s.INVOICE_DISCOUNT - s.PRODUCT_COST AS GP
      FROM sales s
      JOIN items i ON i.ITEM_CODE = s.ITEM_CODE
      JOIN accts a ON a.ACCOUNT_CODE = s.ACCOUNT_CODE
      WHERE a.WAREHOUSE_CODE::VARCHAR IN ('4', '6')
    ),
    w AS (
      SELECT LCD, DATE_TRUNC('YEAR', LCD)::DATE AS YTD_S, DATEADD(MONTH, -12, LCD)::DATE AS PY_E,
             DATE_TRUNC('YEAR', DATEADD(MONTH, -12, LCD))::DATE AS PY_S
      FROM (SELECT MAX(D) AS LCD FROM f WHERE D < '${today}')
    )
    SELECT GROUPING(D) AS G, f.D, f.WH, f.PQD, f.SUPPLIER_NAME, f.BRAND_FAMILY, f.COT, f.CHAIN,
           SUM(CE) AS CE, SUM(GP) AS GP,
           SUM(CASE WHEN D BETWEEN w.YTD_S AND w.LCD THEN CE ELSE 0 END) AS CE_TY,
           SUM(CASE WHEN D BETWEEN w.YTD_S AND w.LCD THEN GP ELSE 0 END) AS GP_TY,
           SUM(CASE WHEN D BETWEEN w.PY_S AND w.PY_E THEN CE ELSE 0 END) AS CE_LY,
           SUM(CASE WHEN D BETWEEN w.PY_S AND w.PY_E THEN GP ELSE 0 END) AS GP_LY
    FROM f CROSS JOIN w
    GROUP BY GROUPING SETS ((f.D, f.WH, f.PQD), (f.WH, f.SUPPLIER_NAME, f.BRAND_FAMILY, f.COT, f.CHAIN))
    HAVING GROUPING(D) = 0 OR CE_TY <> 0 OR CE_LY <> 0 OR GP_TY <> 0 OR GP_LY <> 0`;
}

/** Split the single result set into the two row sets the builder expects. */
function splitRows(rows) {
  const daily = [], dims = [];
  for (const r of rows) {
    if (String(r.G) === '0') daily.push({ D: String(r.D).slice(0, 10), WH: r.WH, PQD: r.PQD, CE: r.CE, GP: r.GP });
    else dims.push({ WH: r.WH, SUPPLIER_NAME: r.SUPPLIER_NAME, BRAND_FAMILY: r.BRAND_FAMILY, COT: r.COT, CHAIN: r.CHAIN, CE_TY: r.CE_TY, GP_TY: r.GP_TY, CE_LY: r.CE_LY, GP_LY: r.GP_LY });
  }
  return { daily, dims };
}

module.exports = { dashboardSql, splitRows };
