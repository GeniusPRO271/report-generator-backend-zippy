/**
 * Excel-style formula transpiler (European format)
 *
 * Converts formulas like:
 *   =IF(amount*1,7%<650;650*1,19;amount*1,7%*1,19)
 *   =amount*3%
 *   =MIN(amount*5%;1000)
 *   =ROUND(amount*2,5%)
 *
 * European conventions:
 *   , = decimal separator  (1,7 → 1.7)
 *   ; = argument separator (IF(a;b;c) → IF(a,b,c))
 *   % = percent operator   (1,7% → (1.7/100))
 */

// Helper functions injected at evaluation time
const __IF = (cond: unknown, thenVal: number, elseVal: number): number =>
  cond ? thenVal : elseVal;

const __SUM = (...args: number[]): number =>
  args.reduce((a, b) => a + b, 0);

/**
 * Transpile a European Excel-style formula to a valid JavaScript expression.
 */
export function excelFormulaToJS(formula: string): string {
  let f = formula.trim();

  // 1. Strip leading = if present
  if (f.startsWith("=")) {
    f = f.slice(1);
  }

  // 2. Replace , → . (European decimal to JS decimal)
  f = f.replace(/,/g, ".");

  // 3. Replace percentage operator: number% → (number/100)
  //    Matches integers and decimals followed by %
  f = f.replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");

  // 4. Replace ; → , (European argument separator to JS separator)
  f = f.replace(/;/g, ",");

  // 5. Replace Excel function names with JS equivalents (case-insensitive)
  f = f.replace(/\bIF\s*\(/gi, "__IF(");
  f = f.replace(/\bSUM\s*\(/gi, "__SUM(");
  f = f.replace(/\bMIN\s*\(/gi, "Math.min(");
  f = f.replace(/\bMAX\s*\(/gi, "Math.max(");
  f = f.replace(/\bABS\s*\(/gi, "Math.abs(");
  f = f.replace(/\bROUND\s*\(/gi, "Math.round(");

  return f;
}

/**
 * Convert a European Excel-style formula to native Excel formula format
 * (English function names, dot decimals, comma separators).
 * Used when writing formulas into Excel cells via ExcelJS.
 */
export function excelFormulaToExcelNative(
  formula: string,
  amountValue: number,
): string {
  let f = formula.trim();

  // Strip leading =
  if (f.startsWith("=")) {
    f = f.slice(1);
  }

  // Replace amount with the actual value
  f = f.replace(/\bamount\b/gi, amountValue.toString());

  // Convert , → . (decimals)
  f = f.replace(/,/g, ".");

  // Keep % as-is (Excel understands %)

  // Convert ; → , (arg separators)
  f = f.replace(/;/g, ",");

  // Function names are already Excel-compatible (IF, MIN, MAX, ABS, ROUND, SUM)

  return f;
}

const compiledCache = new Map<string, (amount: number) => number>();

/**
 * Compile and cache a formula function.
 */
function compileFormula(jsExpr: string): (amount: number) => number {
  const cached = compiledCache.get(jsExpr);
  if (cached) return cached;

  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "amount",
    "__IF",
    "__SUM",
    "Math",
    `"use strict"; return (${jsExpr});`,
  ) as (
    amount: number,
    ifFn: typeof __IF,
    sumFn: typeof __SUM,
    math: typeof Math,
  ) => number;

  const bound = (amount: number) => fn(amount, __IF, __SUM, Math);
  compiledCache.set(jsExpr, bound);
  return bound;
}

/**
 * Validate a European Excel-style formula.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateExcelFormula(
  formula: string,
): { valid: boolean; error?: string } {
  try {
    const jsExpr = excelFormulaToJS(formula);
    const fn = compileFormula(jsExpr);
    const result = fn(100);
    if (!Number.isFinite(result)) {
      return { valid: false, error: "Formula produces non-finite result" };
    }
    return { valid: true };
  } catch (e: any) {
    return { valid: false, error: e?.message ?? "Invalid formula syntax" };
  }
}

/**
 * Evaluate a European Excel-style formula with a given amount.
 * Returns 0 on any error.
 */
export function evaluateExcelFormula(
  formula: string,
  amount: number,
): number {
  try {
    const jsExpr = excelFormulaToJS(formula);
    const fn = compileFormula(jsExpr);
    const v = Number(fn(amount));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
