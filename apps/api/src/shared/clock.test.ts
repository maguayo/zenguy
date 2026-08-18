import { FixedClock } from "./clock";

describe("FixedClock", () => {
  it("returns its configured time", () => {
    expect(new FixedClock(1_700_000_000_000).now()).toBe(1_700_000_000_000);
  });

  it("advances by milliseconds", () => {
    const clock = new FixedClock(1_000);

    clock.advance(250);
    expect(clock.now()).toBe(1_250);
    clock.advance(750);
    expect(clock.now()).toBe(2_000);
  });
});
