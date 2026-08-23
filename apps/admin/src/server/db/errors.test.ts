import { isMigrationPendingError } from "./errors";

it("recognises D1 schema errors", () => {
  expect(
    isMigrationPendingError(new Error("D1_ERROR: no such table: runner_workers: SQLITE_ERROR")),
  ).toBe(true);
  expect(isMigrationPendingError(new Error("no such column: claimed_by_runner_id"))).toBe(true);
  expect(isMigrationPendingError(new Error("D1_ERROR: database is locked"))).toBe(false);
  expect(isMigrationPendingError("nope")).toBe(false);
});
