import type { IdGenerator, IdPrefix } from "../../shared/ids";

export class FakeIds implements IdGenerator {
  private sequence = 0;

  newId(prefix: IdPrefix): string {
    this.sequence += 1;
    return `${prefix}_${String(this.sequence).padStart(26, "0")}`;
  }
}
