/** Money is summed in satang (integer) so 0.1 + 0.2 style float errors can't creep into totals. */
export const toSatang = (amount: number | string | null | undefined) => Math.round(Number(amount ?? 0) * 100);
export const fromSatang = (satang: number) => satang / 100;
