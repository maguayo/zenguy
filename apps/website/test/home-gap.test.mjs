import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../src/pages/index.astro", import.meta.url);

test("home goes from the hero into how it works, without a leftover gap band", async () => {
  const source = await readFile(indexUrl, "utf8");
  const main = source.match(/<main>([\s\S]*?)<\/main>/u);
  assert.ok(main, "expected a main landmark on the homepage");
  assert.match(
    main[1],
    /<Hero\s*\/>\s*<WatchItRun\s*\/>/u,
    "How it works should follow the hero directly",
  );
  assert.doesNotMatch(source, /proposal2\/Night/u);
});

test("alerts come before the failure-report section", async () => {
  const source = await readFile(indexUrl, "utf8");
  const main = source.match(/<main>([\s\S]*?)<\/main>/u);
  assert.ok(main, "expected a main landmark on the homepage");
  assert.match(
    main[1],
    /<Reaches\s*\/>\s*<Evidence2\s*\/>/u,
    "One alert when it breaks should sit above When it fails, you get the whole story",
  );
});
