import { sql, SQL } from "drizzle-orm";
import { AnyColumn } from "drizzle-orm";

/**
 * Approximate exchange rates to USD.
 * Used for converting transaction amounts to a common display currency.
 */
export const CURRENCY_TO_USD: Record<string, number> = {
  USD: 1.0,

  // South American
  ARS: 0.001,
  BOB: 0.145,
  BRL: 0.2,
  CLP: 0.001,
  COP: 0.00025,
  PEN: 0.27,
  PYG: 0.00013,
  UYU: 0.025,
  VES: 0.027,
  GYD: 0.0048,
  SRD: 0.028,

  // Other
  EUR: 1.1,
  GBP: 1.27,
  CAD: 0.74,
  MXN: 0.05,
};

/**
 * Builds a SQL expression that converts `quantity` from its native currency to `displayCurrency`.
 *
 * Formula: quantity::numeric * (toUsdRate[sourceCurrency] / toUsdRate[displayCurrency])
 *
 * Returns a raw SQL fragment like:
 *   quantity::numeric * CASE currency WHEN 'USD' THEN 1.0 WHEN 'CLP' THEN 0.001 ... ELSE 1.0 END / 0.001
 */
export function buildConvertedAmountSql(
  quantityCol: AnyColumn,
  currencyCol: AnyColumn,
  displayCurrency: string,
): SQL {
  const targetRate = CURRENCY_TO_USD[displayCurrency.toUpperCase()] ?? 1.0;

  const caseParts = Object.entries(CURRENCY_TO_USD)
    .map(([cur, rate]) => `WHEN '${cur}' THEN ${rate}`)
    .join(" ");

  return sql`(${quantityCol}::numeric * (CASE ${currencyCol} ${sql.raw(caseParts)} ELSE 1.0 END) / ${targetRate})`;
}
