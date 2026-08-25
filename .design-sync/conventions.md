# Zenguy web app conventions

## Setup

Components come from `window.Zenguy.*`. Wrap every tree in `<DSProvider>` (exported from the bundle): it provides the router, react-query, and auth contexts that `Sidebar`, `AppLayout`, `WorkspaceSwitcher`, `RunStatusPanel`, and other app components read — without it they throw. Leaf primitives (`Button`, `Badge`, `Input`, …) work anywhere, but wrapping once at the root is always safe.

## Styling idiom

Tailwind utility classes on plain elements; components carry their own styling via props, never restyle their internals. Zenguy V1 is deliberately plain: **white cards on a zinc-50 page, indigo as the only accent, no gradients, no dark mode, shadows only on overlays.**

- Page container: `max-w-6xl mx-auto px-4 md:px-6 py-6` on `bg-zinc-50`.
- Card/panel: `bg-white border border-zinc-200 rounded-lg` (+ `p-4` or `p-6`). No shadow.
- Page title: `text-xl font-semibold`; section title: `text-sm font-semibold text-zinc-900`; secondary text: `text-zinc-500`; body defaults to `text-sm text-zinc-900`.
- Spacing rhythm 4/8/12/16/24 → `gap-1/2/3/4/6`, `p-2/3/4/6`. Tables are dense (`py-2.5` cells); controls are `h-9`.
- Accent (indigo) is reserved for primary actions and links: `bg-accent-600 hover:bg-accent-700 text-white`, `text-accent-700`, `bg-accent-50`. Status colors ONLY for status: `ok` (green), `danger` (red), `warn` (amber), `info` (blue) — e.g. `text-ok-700`, `bg-danger-50 text-danger-700`.
- Fonts: Inter is the default (set on `body` — no class needed; a `font-sans` class does not exist here); `font-mono` (IBM Plex Mono) for IDs, URLs, code. `font-display` (Newsreader italic) exists but is used only for auth/marketing accents.

The token values behind these live as CSS custom properties in `styles.css` (`--color-accent-600: #4f46e5`, `--color-ok-600`, `--font-sans`, …). Prefer `Button variant="primary|secondary|danger|ghost"`, `Badge tone="ok|danger|warn|info|neutral"`-style props over hand-painting colors.

## Where the truth lives

Read `styles.css` (imports `_ds_bundle.css` — the full compiled stylesheet and `@theme` tokens) before inventing any class: **only classes appearing there exist** — arbitrary Tailwind values not in that file render unstyled. Each component's API is its `components/<group>/<Name>/<Name>.d.ts`; usage patterns are in `<Name>.prompt.md`.

## Idiomatic example

```jsx
const { DSProvider, Button, StatusBadge, Table, PageHeader } = window.Zenguy;

<DSProvider>
  <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
    <PageHeader
      actions={<Button variant="primary">New test</Button>}
      title="Tests"
    />
    <div className="mt-4 bg-white border border-zinc-200 rounded-lg p-4">
      <Table
        columns={[
          { header: "Test", key: "name", render: (r) => r.name },
          { header: "Status", key: "s", render: (r) => <StatusBadge status={r.status} /> },
        ]}
        rowKey={(r) => r.id}
        rows={[{ id: "1", name: "Checkout flow", status: "PASSED" }]}
      />
    </div>
  </div>
</DSProvider>
```
