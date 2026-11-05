import { describe, expect, it } from 'vitest';
import { arsCents, overviewModel, type MonthTotals, type Rate } from './money';

// Synthetic months: kind, then category, then currency, to integer cents (data spec Contracts "HTTP routes", GET /totals).
const month = (m: string, income: { ARS?: number; USD?: number }, expense: { ARS?: number; USD?: number }, other = {}): MonthTotals => ({
  month: m,
  totals: {
    income: { Income: income },
    expense: { Groceries: Object.fromEntries(Object.entries(expense).map(([c, v]) => [c, -v])) },
    ...other,
  },
});
const rate = (m: string, ars_per_usd: number): Rate => ({ month: m, ars_per_usd });

describe('T-WSCR-2: typical month (D-20, D-85)', () => {
  // Each earlier month earns 1,000.00 ARS and keeps a known share.
  const kept = (m: string, pct: number) => month(m, { ARS: 100_000 }, { ARS: 100_000 - pct * 1_000 });
  const months = [
    kept('2026-01', 10),
    kept('2026-02', 20),
    kept('2026-03', 30),
    kept('2026-04', 40),
    kept('2026-05', 50),
    kept('2026-06', 60),
    kept('2026-07', 70),
  ];
  const allRated = months.map((m) => rate(m.month, 1300));
  const current = month('2026-08', { ARS: 200_000 }, { ARS: 150_000 });

  it('T-WSCR-2: below 3 earlier rated months there is no typical month', () => {
    const totals = [kept('2026-06', 60), kept('2026-07', 70), current];
    const m = overviewModel('2026-08', totals, [rate('2026-06', 1), rate('2026-07', 1), rate('2026-08', 1)]);
    expect(m.typicalPct).toBeUndefined();
    expect(m.typicalMonths).toBe(2);
  });

  it('T-WSCR-2: with exactly 3 earlier rated months it averages those 3', () => {
    const totals = [kept('2026-05', 50), kept('2026-06', 60), kept('2026-07', 70), current];
    const m = overviewModel(
      '2026-08',
      totals,
      totals.map((t) => rate(t.month, 1300)),
    );
    expect(m.typicalMonths).toBe(3);
    expect(m.typicalPct).toBeCloseTo(60, 10);
  });

  it('T-WSCR-2: it averages at most the 6 latest earlier rated months', () => {
    const m = overviewModel('2026-08', [...months, current], [...allRated, rate('2026-08', 1300)]);
    expect(m.typicalMonths).toBe(6);
    // 2026-02 to 2026-07: 20..70, mean 45; 2026-01 (10) is left out.
    expect(m.typicalPct).toBeCloseTo(45, 10);
  });

  it('T-WSCR-2: months without a rate are skipped, and earlier rated ones fill in', () => {
    const rated = allRated.filter((r) => r.month !== '2026-06' && r.month !== '2026-07');
    const m = overviewModel('2026-08', [...months, current], rated);
    expect(m.typicalMonths).toBe(5);
    expect(m.typicalPct).toBeCloseTo((10 + 20 + 30 + 40 + 50) / 5, 10);
  });

  it('T-WSCR-2: skipped months can leave fewer than 3, so no typical month', () => {
    const m = overviewModel('2026-08', [...months, current], [rate('2026-01', 1300), rate('2026-07', 1300)]);
    expect(m.typicalMonths).toBe(2);
    expect(m.typicalPct).toBeUndefined();
  });

  it('T-WSCR-2: only earlier months count, never the month itself or a later one', () => {
    const later = kept('2026-09', 99);
    const m = overviewModel('2026-04', [...months, later], [...allRated, rate('2026-09', 1300)]);
    // 2026-01..2026-03: 10, 20, 30.
    expect(m.typicalMonths).toBe(3);
    expect(m.typicalPct).toBeCloseTo(20, 10);
  });

  it('T-WSCR-2: the exact average is kept (whole numbers are for display only, D-30)', () => {
    const totals = [kept('2026-01', 10), kept('2026-02', 20), month('2026-03', { ARS: 300_000 }, { ARS: 200_000 }), current];
    const m = overviewModel(
      '2026-08',
      totals,
      totals.map((t) => rate(t.month, 1300)),
    );
    expect(m.typicalPct).toBeCloseTo((10 + 20 + 100 / 3) / 3, 10);
  });

  it('T-WSCR-2: an earlier month converts its dollars at its own rate', () => {
    const usd = (m: string) => month(m, { USD: 100_00 }, { ARS: 50_000_00 });
    // 100 USD at 1,000 = 100,000 ARS earned, 50,000 spent: 50%. At 2,000: 200,000 earned, 75%.
    const totals = [usd('2026-01'), usd('2026-02'), usd('2026-03'), current];
    const m = overviewModel('2026-08', totals, [rate('2026-01', 1000), rate('2026-02', 2000), rate('2026-03', 1000)]);
    expect(m.typicalPct).toBeCloseTo((50 + 75 + 50) / 3, 10);
  });
});

describe('T-WSCR-3: the bad month (AC-11)', () => {
  it('T-WSCR-3: spending more than was earned is bad, with the overspend', () => {
    const m = overviewModel('2026-03', [month('2026-03', { ARS: 1_000_000_00 }, { ARS: 1_250_000_50 })], [rate('2026-03', 1272.27)]);
    expect(m.bad).toBe(true);
    expect(m.earnedArs).toBe(1_000_000_00);
    expect(m.spentArs).toBe(1_250_000_50);
    expect(m.keptArs).toBe(-250_000_50);
    expect(m.overArs).toBe(250_000_50);
    expect(m.keptPct).toBeCloseTo(-25.00005, 10);
  });

  it('T-WSCR-3: spending exactly what was earned is not bad', () => {
    const m = overviewModel('2026-03', [month('2026-03', { ARS: 500_00 }, { ARS: 500_00 })], [rate('2026-03', 1)]);
    expect(m.bad).toBe(false);
    expect(m.overArs).toBeUndefined();
    expect(m.keptArs).toBe(0);
    expect(m.keptPct).toBe(0);
  });

  it('T-WSCR-3: a good month is not bad and has no overspend', () => {
    const m = overviewModel('2026-03', [month('2026-03', { ARS: 1_000_00 }, { ARS: 680_00 })], [rate('2026-03', 1)]);
    expect(m).toMatchObject({ bad: false, keptArs: 320_00, keptPct: 32 });
    expect(m.overArs).toBeUndefined();
  });

  it('T-WSCR-3: the overspend counts dollars at the month rate', () => {
    // Earned 1,000 USD at 1,300 = 1,300,000 ARS; spent 1,200,000 ARS and 200 USD (260,000 ARS): 160,000 over.
    const m = overviewModel('2026-03', [month('2026-03', { USD: 1_000_00 }, { ARS: 1_200_000_00, USD: 200_00 })], [rate('2026-03', 1300)]);
    expect(m.bad).toBe(true);
    expect(m.overArs).toBe(160_000_00);
  });

  it('T-WSCR-3: spending with no earnings at all is bad, by the whole spend', () => {
    const m = overviewModel('2026-03', [month('2026-03', {}, { ARS: 75_00 })], [rate('2026-03', 1)]);
    expect(m).toMatchObject({ bad: true, earnedArs: 0, spentArs: 75_00, overArs: 75_00 });
  });
});

describe('overviewModel: amounts (D-23, D-31)', () => {
  it('T-WSCR-3: dollars convert at the month rate, cents rounded half away from zero', () => {
    expect(arsCents(1, 1272.27)).toBe(1272); // 12.7227 ARS → 1,272 cents
    expect(arsCents(1, 1272.5)).toBe(1273); // exactly half: away from zero
    expect(arsCents(-1, 1272.5)).toBe(-1273);
    expect(arsCents(192_200, 1375)).toBe(264_275_000);
    expect(arsCents(12_345, 1321.07)).toBe(16_308_609); // 16,308,609.15 → 16,308,609
  });

  it('T-WSCR-3: earned shows pesos at the rate plus the dollars received', () => {
    const m = overviewModel('2026-05', [month('2026-05', { ARS: 100_00, USD: 1_922_00 }, { ARS: 50_00 })], [rate('2026-05', 1375)]);
    expect(m).toMatchObject({ earnedArs: 100_00 + 2_642_750_00, earnedUsd: 1_922_00, rate: 1375, noRate: false });
  });

  it('T-WSCR-3: only income is earned and only expense is spent; transfers and inflows are neither', () => {
    const m = overviewModel(
      '2026-05',
      [
        month(
          '2026-05',
          { ARS: 1_000_00 },
          { ARS: 400_00 },
          { transfer_out: { Transfers: { ARS: -300_00 } }, inflow: { Transfers: { ARS: 900_00 } } },
        ),
      ],
      [rate('2026-05', 1)],
    );
    expect(m).toMatchObject({ earnedArs: 1_000_00, spentArs: 400_00, keptArs: 600_00, keptPct: 60 });
  });

  it('T-WSCR-3: a refund inside expense lowers the spend', () => {
    const m = overviewModel(
      '2026-05',
      [{ month: '2026-05', totals: { income: { Income: { ARS: 1_000_00 } }, expense: { Groceries: { ARS: -500_00 }, Home: { ARS: 100_00 } } } }],
      [rate('2026-05', 1)],
    );
    expect(m.spentArs).toBe(400_00);
  });

  it('T-WSCR-3: a month with no rate leaves its dollars out of the pesos and says so', () => {
    const m = overviewModel('2026-10', [month('2026-10', { ARS: 100_00, USD: 1_000_00 }, { ARS: 50_00, USD: 10_00 })], []);
    expect(m).toMatchObject({ noRate: true, earnedArs: 100_00, spentArs: 50_00, earnedUsd: 1_000_00 });
    expect(m.rate).toBeUndefined();
  });

  it('T-WSCR-3: a month with no data is all zero', () => {
    const m = overviewModel('2026-11', [], [rate('2026-11', 1400)]);
    expect(m).toMatchObject({ earnedArs: 0, spentArs: 0, keptArs: 0, keptPct: 0, bad: false, noRate: false, typicalMonths: 0 });
  });
});
