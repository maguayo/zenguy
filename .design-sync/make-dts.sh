#!/bin/sh
# Emits the declaration tree design-sync's prop extractor reads (the app ships
# no types entry of its own) and a barrel covering the component files.
set -e
cd "$(dirname "$0")/../apps/frontend"
./node_modules/.bin/tsc -p tsconfig.dts.json
{
  for f in dist/types/components/*.d.ts dist/types/components/ui/*.d.ts; do
    rel=${f#dist/types/}
    case "$rel" in *test*) continue ;; esac
    printf 'export * from "./%s";\n' "${rel%.d.ts}"
  done
} > dist/types/index.d.ts
