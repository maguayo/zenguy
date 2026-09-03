import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function packagesFromLock(path) {
  const content = readFileSync(path, "utf8");
  const packageSection = content.split(/^snapshots:\s*$/mu)[0] ?? content;
  const components = [];
  for (const line of packageSection.split("\n")) {
    const match = /^  (?:'([^']+)'|([^:\s][^:]*)):\s*$/u.exec(line);
    const raw = match?.[1] ?? match?.[2];
    if (!raw || raw === "packages" || raw.startsWith("file:") || raw.startsWith("link:")) continue;
    const withoutPeers = raw.replace(/\(.+\)$/u, "");
    const separator = withoutPeers.lastIndexOf("@");
    if (separator <= 0) continue;
    const name = withoutPeers.slice(0, separator);
    const version = withoutPeers.slice(separator + 1);
    if (!version || !/^\d/u.test(version)) continue;
    const purlName = name.startsWith("@")
      ? `%40${name.slice(1).replace("/", "/")}`
      : encodeURIComponent(name);
    components.push({
      "bom-ref": `pkg:npm/${purlName}@${version}`,
      name,
      purl: `pkg:npm/${purlName}@${version}`,
      type: "library",
      version,
    });
  }
  return components;
}

const output = process.argv[2];
if (!output) throw new Error("Usage: generate-sbom.mjs <output.json>");
const { version: appVersion } = JSON.parse(readFileSync("apps/app/package.json", "utf8"));
const unique = new Map();
for (const path of ["pnpm-lock.yaml", "apps/app/pnpm-lock.yaml"]) {
  for (const component of packagesFromLock(path)) unique.set(component["bom-ref"], component);
}
const bom = {
  bomFormat: "CycloneDX",
  components: [...unique.values()].sort((left, right) =>
    left["bom-ref"].localeCompare(right["bom-ref"]),
  ),
  metadata: { component: { name: "zenguy", type: "application", version: appVersion } },
  specVersion: "1.5",
  version: 1,
};
writeFileSync(resolve(output), `${JSON.stringify(bom, null, 2)}\n`, { mode: 0o600 });
console.log(`Generated CycloneDX inventory with ${bom.components.length} components.`);
