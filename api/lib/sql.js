// The model's rules, in SQL. Same CTE the Streamlit port uses; reconciled to the Power BI model to the cent.
const DB = () => `${process.env.SNOWFLAKE_DATABASE || 'SED_DB'}.${process.env.SNOWFLAKE_SCHEMA || 'PUBLIC'}`;

function factCte(years) {
  const union = years.map((y) =>
    `      SELECT INVOICE_DATE, ACCOUNT_CODE, ITEM_CODE, INVOICE_QTY, PRODUCT_SALES, PRODUCT_COST, INVOICE_DISCOUNT, INVOICE_VIP_UNIT_ID
      FROM ${DB()}.VW_BASE_SALES_V2_${y} WHERE RECORD_STATUS = 'A'`).join('\n      UNION ALL\n');
  return `
    WITH items AS (
      SELECT ITEM_CODE, SUPPLIER_NAME, BRAND_NAME AS BRAND_FAMILY, ITEM_CUSTOM_LABEL_3 AS PQD, OZ_CASE
      FROM ${DB()}.VW_BASE_ITEMS_V2
      WHERE RECORD_STATUS = 'A' AND (ROW_EXPIRATION_DATE IS NULL OR ROW_EXPIRATION_DATE::DATE >= CURRENT_DATE)
        AND ITEM_CUSTOM_LABEL_3 IS NOT NULL AND ITEM_CUSTOM_LABEL_3 <> ''
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ITEM_CODE ORDER BY ROW_EXPIRATION_DATE DESC NULLS FIRST) = 1
    ),
    accts AS (
      SELECT ACCOUNT_CODE, WAREHOUSE_CODE, CHAIN, COT
      FROM ${DB()}.VW_ALL_ACCOUNTS_V2
      WHERE RECORD_STATUS = 'A' AND (ROW_EXPIRATION_DATE IS NULL OR ROW_EXPIRATION_DATE::DATE >= CURRENT_DATE)
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
    )`;
}

const dailyPqdSql = (years) => factCte(years) + `
    SELECT D, WH, PQD, SUM(CE) AS CE, SUM(GP) AS GP FROM f GROUP BY 1, 2, 3`;

const dimsSql = (years, w) => factCte(years) + `
    SELECT WH, SUPPLIER_NAME, BRAND_FAMILY, COT, CHAIN,
           SUM(CASE WHEN D BETWEEN '${w.ytd_start}' AND '${w.ytd_end}' THEN CE ELSE 0 END) AS CE_TY,
           SUM(CASE WHEN D BETWEEN '${w.ytd_start}' AND '${w.ytd_end}' THEN GP ELSE 0 END) AS GP_TY,
           SUM(CASE WHEN D BETWEEN '${w.py_ytd_start}' AND '${w.py_ytd_end}' THEN CE ELSE 0 END) AS CE_LY,
           SUM(CASE WHEN D BETWEEN '${w.py_ytd_start}' AND '${w.py_ytd_end}' THEN GP ELSE 0 END) AS GP_LY
    FROM f
    WHERE D BETWEEN '${w.ytd_start}' AND '${w.ytd_end}' OR D BETWEEN '${w.py_ytd_start}' AND '${w.py_ytd_end}'
    GROUP BY 1, 2, 3, 4, 5`;

module.exports = { dailyPqdSql, dimsSql };
