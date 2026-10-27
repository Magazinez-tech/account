/** Same day next month (UTC), clamped to that month's last day: Jan 31 -> Feb 28 (or 29). */
export function addMonth(d: Date): Date {
  const next = new Date(d);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/** VAT on a pre-VAT price, all in satang; VAT rounds half up to the nearest satang. */
export function priceWithVat(subtotal: number, vatRate: number) {
  const vat = Math.round((subtotal * vatRate) / 100);
  return { subtotal, vat, total: subtotal + vat };
}
