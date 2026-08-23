import { countOccurrences, upcomingWindows } from "./occurrences";

const H = 3_600_000;

describe("countOccurrences", () => {
  it("counts runs scheduled inside [now, windowEnd]", () => {
    expect(countOccurrences(100 + H, H, 100, 100 + 3 * H)).toBe(3); // at +1h, +2h, +3h
    expect(countOccurrences(100 + 3 * H, H, 100, 100 + 3 * H)).toBe(1); // exactly on the boundary
    expect(countOccurrences(100 + 3 * H + 1, H, 100, 100 + 3 * H)).toBe(0);
  });

  it("treats an overdue item as running now, then keeps its cadence", () => {
    expect(countOccurrences(50, H, 100, 100 + H)).toBe(2); // now + 1h later
    expect(countOccurrences(50, H, 100, 100 + H - 1)).toBe(1);
  });

  it("is defensive about bad intervals", () => {
    expect(countOccurrences(100, 0, 100, 100 + H)).toBe(0);
    expect(countOccurrences(100, -5, 100, 100 + H)).toBe(0);
  });

  it("is defensive about non-finite inputs", () => {
    expect(countOccurrences(Number.NaN, H, 100, 100 + H)).toBe(0);
    expect(countOccurrences(100, Number.POSITIVE_INFINITY, 100, 100 + H)).toBe(0);
    expect(countOccurrences(100, H, Number.NaN, 100 + H)).toBe(0);
    expect(countOccurrences(100, H, 100, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

it("aggregates the three windows", () => {
  expect(
    upcomingWindows(
      [
        { nextAt: 100 + H / 2, intervalMs: H },
        { nextAt: 100 + 20 * H, intervalMs: 6 * H },
      ],
      100,
    ),
  ).toEqual({ h1: 1, h3: 3, h24: 25 });
});
