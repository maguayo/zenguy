import { readFileSync } from "node:fs";
import path from "node:path";
import { PLAN_PRICE_CENTS, RUNNER_ONLINE_THRESHOLD_MS } from "./constants";

it("keeps the online threshold in sync with apps/api", () => {
  const source = readFileSync(
    path.join(import.meta.dirname, "../../../api/src/shared/constants.ts"),
    "utf8",
  );
  const match = /RUNNER_ONLINE_THRESHOLD_MS = ([\d_]+)/u.exec(source);
  expect(Number(match?.[1]?.replaceAll("_", ""))).toBe(RUNNER_ONLINE_THRESHOLD_MS);
});

it("keeps the plan price in sync with apps/api", () => {
  const source = readFileSync(
    path.join(import.meta.dirname, "../../../api/src/shared/constants.ts"),
    "utf8",
  );
  const match = /PLAN_PRICE_CENTS = ([\d_]+)/u.exec(source);
  expect(Number(match?.[1]?.replaceAll("_", ""))).toBe(PLAN_PRICE_CENTS);
});
