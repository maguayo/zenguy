#!/bin/sh
# Rebuilds the stable CSS entry design-sync ships: Google Fonts import (same
# families index.html loads) + the compiled Tailwind output from the Vite build.
set -e
cd "$(dirname "$0")/.."
printf '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@1,6..72,400;1,6..72,500&display=swap");\n' > apps/frontend/dist/ds-entry.css
cat apps/frontend/dist/assets/index-*.css >> apps/frontend/dist/ds-entry.css
