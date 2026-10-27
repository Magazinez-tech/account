import { addMonth, priceWithVat } from './billing-math';

const utc = (iso: string) => new Date(`${iso}Z`);

describe('addMonth', () => {
  it('moves to the same day and time next month', () => {
    expect(addMonth(utc('2026-09-25T08:30:00'))).toEqual(utc('2026-10-25T08:30:00'));
  });

  it('crosses the year boundary', () => {
    expect(addMonth(utc('2026-12-15T00:00:00'))).toEqual(utc('2027-01-15T00:00:00'));
  });

  it('clamps to the last day of shorter months', () => {
    expect(addMonth(utc('2026-01-31T12:00:00'))).toEqual(utc('2026-02-28T12:00:00'));
    expect(addMonth(utc('2028-01-31T12:00:00'))).toEqual(utc('2028-02-29T12:00:00')); // leap year
    expect(addMonth(utc('2026-03-31T12:00:00'))).toEqual(utc('2026-04-30T12:00:00'));
  });

  it('does not mutate its argument', () => {
    const d = utc('2026-05-10T00:00:00');
    addMonth(d);
    expect(d).toEqual(utc('2026-05-10T00:00:00'));
  });
});

describe('priceWithVat', () => {
  it('adds 7% VAT to the plan prices', () => {
    expect(priceWithVat(29000, 7)).toEqual({ subtotal: 29000, vat: 2030, total: 31030 });
    expect(priceWithVat(79000, 7)).toEqual({ subtotal: 79000, vat: 5530, total: 84530 });
    expect(priceWithVat(199000, 7)).toEqual({ subtotal: 199000, vat: 13930, total: 212930 });
  });

  it('rounds VAT to the nearest satang', () => {
    expect(priceWithVat(1050, 7).vat).toBe(74); // 73.5 -> 74
    expect(priceWithVat(1, 7).vat).toBe(0);
  });

  it('handles a zero rate', () => {
    expect(priceWithVat(5000, 0)).toEqual({ subtotal: 5000, vat: 0, total: 5000 });
  });
});
