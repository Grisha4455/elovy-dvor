import { describe, expect, it } from "vitest";
import { calculateQuote } from "../src/domain/pricing.js";
import { normalizeBelarusPhone } from "../src/domain/phone.js";
import { eachNight, isIsoDate } from "../src/domain/dates.js";

describe("calculateQuote", () => {
  it("считает будние ночи по базовой цене", () => {
    // пн → ср
    expect(calculateQuote(100, "2026-11-09", "2026-11-11")).toMatchObject({ nights: 2, total: 200, discount: 0 });
  });

  it("добавляет 20% за ночи пт→сб и сб→вс", () => {
    // чт, пт, сб, вс
    const q = calculateQuote(100, "2026-11-12", "2026-11-16");
    expect(q.breakdown.map((n) => n.price)).toEqual([100, 120, 120, 100]);
    expect(q.total).toBe(440);
  });

  it("праздник важнее выходного и не суммируется с ним", () => {
    // 7 ноября 2026 — суббота и праздник
    const q = calculateQuote(100, "2026-11-07", "2026-11-08");
    expect(q.breakdown[0]).toEqual({ date: "2026-11-07", price: 130, tag: "holiday" });
  });

  it("даёт скидку 10% от 7 ночей", () => {
    const q = calculateQuote(100, "2026-11-09", "2026-11-16");
    expect(q.subtotal).toBe(740);
    expect(q.discount).toBe(74);
    expect(q.total).toBe(666);
  });
});

describe("normalizeBelarusPhone", () => {
  it.each([
    ["+375 (29) 123-45-67", "+375291234567"],
    ["80291234567", "+375291234567"],
    ["375441234567", "+375441234567"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeBelarusPhone(input)).toBe(expected);
  });

  it.each(["+7 999 123-45-67", "12345", "+375 99 123-45-67"])("отклоняет %s", (input) => {
    expect(normalizeBelarusPhone(input)).toBeNull();
  });
});

describe("dates", () => {
  it("отклоняет несуществующие даты", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
  });

  it("перечисляет ночи через границу месяца", () => {
    expect(eachNight("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01"]);
  });
});
