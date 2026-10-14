// Exact money arithmetic for documents: amounts are kept as integer cents (BigInt) and rounded half up, so line
// totals, VAT and balances always add up to the cent (SRS §7.2).

/** "1234.5" → 123450n (2 decimals). */
export function toCents(value: string | number): bigint {
  const [whole, frac = ''] = String(value).trim().split('.');
  const sign = whole!.startsWith('-') ? -1n : 1n;
  return sign * (BigInt(whole!.replace('-', '') || '0') * 100n + BigInt((frac + '00').slice(0, 2)));
}

/** 123450n → "1234.50". */
export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Quantity with up to 3 decimals as thousandths: "1.5" → 1500n. */
function toMilli(value: string | number): bigint {
  const [whole, frac = ''] = String(value).trim().split('.');
  return BigInt(whole || '0') * 1000n + BigInt((frac + '000').slice(0, 3));
}

/** a / b rounded half up (a, b ≥ 0). */
function divRound(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (2n * b);
}

/** quantity × unit price, and VAT on it at the rate (percent with 2 decimals), each rounded to the cent. */
export function lineAmounts(quantity: string | number, unitPrice: string | number, taxRate: string | number): { subtotal: bigint; tax: bigint } {
  const subtotal = divRound(toMilli(quantity) * toCents(unitPrice), 1000n);
  const tax = divRound(subtotal * toCents(taxRate), 10000n);
  return { subtotal, tax };
}

/** Percentage of an amount, rounded to the cent (commission = sale value × rate %, rate with up to 3 decimals). */
export function percentOf(amount: string, rate: string): bigint {
  return divRound(toCents(amount) * toMilli(rate), 100_000n);
}
