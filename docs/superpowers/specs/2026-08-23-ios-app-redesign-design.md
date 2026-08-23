# iOS app redesign — "Paper & Pulse"

Date: 2026-08-23 · Scope: `apps/app` presentation layer only (screens, `src/ui`,
`src/theme`, `src/components/**` visuals, icon + splash). Behaviour, API clients,
contexts, query keys, copy semantics, permissions and every `testID` stay as they
are so the Jest suites and the Maestro flows keep passing.

## Why

The first version of the app ported the web screens with a generic Tailwind
palette (zinc + indigo, system font, hairline cards). It works but has no
identity, while the marketing site already owns a strong one: warm paper,
ink typography set in Geist, a single violet accent, mono "instrument" labels
and evidence-first cards. The app should feel like the same product.

## Direction

**Subject.** A quiet instrument panel for people who want to know *before a
customer does* that their store or app still works: real-browser test runs,
uptime checks, incidents, and the alerts that reach them. Its materials are
screenshots (evidence), steps, schedules, durations and run ids.

**Thesis.** Paper, ink and one violet. Calm by default, loud only where
something needs a human: a failed run or an open incident.

### Tokens (`src/theme`)

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `paper` | `#F2EEE6` |
| Raised surface | `surface` | `#FAF8F4` |
| Hairline | `line` | `#E8E2D6` (strong: `sand` `#D8D1C2`) |
| Text | `ink` `#13110D` · `body` `#4A453E` · `muted` `#877F71` · `stone` `#6B655B` (AA on paper) |
| On ink | `parch` `#C9C2B3` · `dusk` `#7C766B` · `inkCard` `#2A2722` |
| Accent | `violet` `#625ED7` · `violetDeep` `#4F4BC4` · `violetInk` `#2D2B7E` · `violetBg` `#EEEDFB` · `violetSoft` `#A9A3F0` |
| Status | `green` `#46A758` (`greenBg` `#E7F3EA`) · `red` `#E5484D` (`redBg` `#FCEBEC`) · `amber` `#C7791F` (`amberBg` `#FBF0E0`) |

Status colours are reserved for status. Violet is the only accent and also
means "in motion" (running, checking, pending) — there is no blue.

**Type.** Geist for everything that reads, Geist Mono for everything that is
measured (ids, durations, schedules, URLs, eyebrows). Loaded at runtime with
`expo-font` from `assets/fonts` (static weights 400/500/600/700; mono 400/500)
behind the splash screen, so no native rebuild is required for the fonts.

| Variant | Size / line | Weight | Notes |
| --- | --- | --- | --- |
| display | 34 / 40 | 700 | letter-spacing −0.8; large native titles use the same face |
| title | 24 / 30 | 600 | −0.4 |
| heading | 17 / 22 | 600 | |
| body | 16 / 22 | 400 | |
| small | 14 / 19 | 400 | |
| caption | 12 / 16 | 500 | |
| eyebrow | 11 / 14 | 500 mono | uppercase, +0.08em, `muted` — section labels |
| mono | 13 / 18 | 400 mono | data |

**Layout.** 20 pt screen gutters, 16 pt rhythm inside cards, 14 pt card radius,
10 pt controls, full pills. Cards are `surface` on `paper` with a `line`
hairline and the site's small shadow (ink 6 % / 24 blur) — only the hero and
primary cards carry the shadow. Lists are one card with 60 pt rows: leading
status tile (36 pt, 10 pt radius, tinted), title, mono meta line, trailing
chevron or action. Sections are introduced by mono eyebrows, never by bold
card titles.

**Signature: the pulse.** A heartbeat strip — a row of small rounded ticks,
one per recent run or check, coloured by result, the newest one breathing when
something is in progress. It sits in the overview hero (ink card on paper, the
only dark element in the app) and on every test and monitor detail, and the
same dot language is used by status pills. It encodes real history (result
order matters), which is why it earns the place of the one memorable element.
Everything around it stays quiet.

```
┌ Overview ──────────────────────────────┐
│ AGUAYO STAGING · eyebrow                │
│ ┌────────────────────── ink hero ─────┐ │
│ │ All clear.               (display)  │ │
│ │ 6 tests · 4 monitors · 0 incidents  │ │
│ │ ▮▮▮▮▯▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮ ◉  ← pulse │ │
│ └─────────────────────────────────────┘ │
│ BROWSER TESTS                           │
│ ┌ 6 tests  ┐ ┌ 1 running ┐ ┌ 0 failed ┐ │  stat tiles
│ UPTIME                                  │
│ ┌ 3 up ┐ ┌ 1 down ┐ ┌ 412 ms avg    ┐   │
│ USAGE THIS CYCLE          ▰▰▰▰▰▱▱▱ 184/300
│ RECENT ACTIVITY                         │
│ ┌ ● Checkout failed      12 min ago ┐   │
└─────────────────────────────────────────┘
```

**Motion.** One orchestrated moment: the overview hero and its strip fade and
rise on first load. Otherwise: press feedback (scale 0.98), breathing dots for
in-progress states, opacity shimmer on skeletons. All gated by
`AccessibilityInfo.isReduceMotionEnabled`.

**Copy.** Existing copy is kept; new hero lines are specific ("All clear",
"1 incident open", "Nothing is running yet"). Empty states tell the next
action. Errors say what happened and how to retry.

**Not in scope.** Dark mode (the identity is light; tokens are structured so a
dark palette can be added later), new native modules, icon packs (Feather stays;
consistency comes from tiles and tone, not glyph style).

## Components

New in `src/ui`: `Eyebrow`, `IconTile`, `StatTile`, `Hero`, `PulseStrip`,
`SectionHeader`, `Pill` (replaces `Badge`, same API plus `pulse`), `Pressable`
scale wrapper. Reworked: `Text` (Geist), `Screen` (paper canvas, large-title
font), `Card`, `Button` (ink primary, violet for the single most important
call-to-action on a screen, outline secondary, ghost, danger), `Input`/`Field`
(surface on paper, violet focus ring, mono for URLs), `ListRow`, `States`
(empty/error/skeleton), `SegmentedTabs` (ink pill on paper), `SelectSheet`,
`Toggle`, `DescriptionList` (mono labels), `ActionMenu`, toast (`ToastContext`).

Stack/tab chrome: large titles in Geist Bold on paper, tint ink, back chevron
ink; tab bar `surface` with `line` top hairline, active ink, inactive stone.

Icon: ink square, cream "z", violet full stop (the wordmark's period). Splash:
paper background with the same mark.

## Process

1. Tokens, fonts, primitives, chrome; exemplar screens (sign-in, overview,
   tests list).
2. Remaining screens in parallel by area (tests, uptime, incidents +
   notifications, more + auth + system gates), each keeping behaviour and
   testIDs.
3. `pnpm typecheck && pnpm lint && pnpm test`, Maestro screenshot flow on the
   simulator against the local API seed, visual review of every screen.
4. Version 0.2.0, commit, `eas build --profile production --auto-submit`,
   verify *Ready to Test* in TestFlight.
