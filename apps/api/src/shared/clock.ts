export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export class FixedClock implements Clock {
  constructor(private time: number) {}

  now(): number {
    return this.time;
  }

  advance(milliseconds: number): void {
    this.time += milliseconds;
  }
}
