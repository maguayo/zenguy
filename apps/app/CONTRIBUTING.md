# Contributing to the Zenguy iOS app

This package mirrors `apps/frontend` screen by screen. Before touching a
screen, read its web counterpart under `apps/frontend/src/pages/**` and port the
behaviour, copy and validation faithfully; only the presentation changes.

## Layout

- `app/` — expo-router routes. URLs match the web app (`/w/[wsId]/tests/[testId]`,
  `/w/[wsId]/runs/[runId]`, …). Tab groups (`(overview)`, `(tests)`, `(uptime)`,
  `(incidents)`, `(more)`) are each a native stack; `(more)` hosts Notifications,
  Secrets, Members, Settings and Account. Do not add registration, workspace
  creation, plan activation, pricing or payment routes to the iOS target.
- `src/api/` — resource clients and `types.ts` (ported verbatim from the web).
- `src/lib/` — `api.ts` (fetch + bearer + Keychain refresh), `format.ts`,
  `errors.ts`, `permissions.ts`, `links.ts`, `share.ts`, `timezones.ts`,
  `stack-options.ts`.
- `src/contexts/` — `useAuth()`, `useWorkspace()`, `useToast()`, `useAppLock()`.
- `src/hooks/` — `useMutationError()` (403/402 handling).
- `src/ui/` — primitives: `Screen`, `Card` (`eyebrow`, `elevated`, `tone`),
  `Hero` (the one ink card, overview only), `StatTile`, `PulseStrip`, `IconTile`,
  `SectionHeader`, `Button` (`accent` once per screen, `primary` ink, `secondary`
  outline, `ghost`, `danger`), `Input` (`mono` for URLs/ids), `PasswordInput`,
  `Field`, `Badge` (`dot`, `pulse`), `ListRow` (`left`, `meta`), `EmptyState`,
  `ErrorState`, `Spinner`, `Skeleton`, `SegmentedTabs`, `SelectSheet`, `Toggle`,
  `DescriptionList`, `ActionMenu` (`showActionMenu`), `confirm()`, `LoadMore`,
  `Press` (spring scale), motion hooks (`useBreathing`, `useReveal`,
  `useReducedMotion`), text variants (`Display`, `Title`, `Heading`, `Body`,
  `Small`, `Muted`, `Caption`, `Label`, `Eyebrow`, `Mono`, `MonoSmall`).
- `src/components/` — domain components (`StatusBadge`, `RunSourceBadge`,
  `ChannelPicker`, `TimezonePicker`, `CopyButton`, `RoleBadge`,
  `FormError`, `AuthShell`, …).
- `src/theme/` — the "Paper & Pulse" tokens: palette, semantic colours, Geist
  faces, spacing, radius, shadows, typography, tones (see *Design system*).

## Design system ("Paper & Pulse")

Spec: `docs/superpowers/specs/2026-08-23-ios-app-redesign-design.md`.

- Canvas is paper (`colors.bg`), surfaces are `colors.surface` cards with a
  `colors.border` hairline; only the primary card of a screen is `elevated`.
  The overview `Hero` is the only dark (ink) element.
- Type: Geist for everything that reads, Geist Mono for everything that is
  measured (ids, URLs, durations, schedules, timestamps → `Mono`, `MonoSmall`,
  `Input mono`). Faces are embedded natively (`app.config.ts` → `expo-font`);
  `Text` maps `fontWeight` to the matching face, so never set `fontFamily` by
  hand outside `src/theme`.
- Sections are introduced by mono `Eyebrow`s (`Card eyebrow=…`,
  `SectionHeader`), not by bold titles. Lists are one `Card padding="none"` of
  `ListRow`s with a leading `IconTile` whose tone is the row's status.
- Violet is the only accent and also means "in motion": one `accent` button per
  screen, links in `colors.accentDark`, running/checking states use tone `info`
  with a breathing dot (`Badge pulse`, `StatusBadge`). Green/red/amber are for
  status only; there is no blue.
- History reads left to right: `PulseStrip` takes ticks oldest-first and
  breathes the newest one while work is in progress. The tests and uptime
  lists draw it under each row from `recentRuns` / `recentChecks`; detail
  screens build it from their own history queries.
- Motion is one orchestrated entrance (`Hero` reveal) plus breathing dots and
  `Press` scale; everything honours Reduce Motion through `useReducedMotion`.
- Light only: `userInterfaceStyle: "light"`; tokens live in one place so a
  dark palette can be added later without touching screens.

## Screen pattern

Reference screens: `app/(auth)/sign-in.tsx` (form) and
`app/w/[wsId]/(tabs)/(overview)/overview.tsx` (data screen).

```tsx
export default function ThingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current, timezone } = useWorkspace();
  const things = useQuery({ queryFn: () => listThings(current.id), queryKey: ["ws", current.id, "things"] });

  return (
    <>
      <Stack.Screen options={{ ...largeTitleOptions, title: "Things", headerRight: () => <ActionMenu items={[...]} /> }} />
      <Screen refreshing={things.isRefetching && !things.isPending} onRefresh={() => void things.refetch()}>
        {things.isPending ? <Spinner /> : things.isError ? <ErrorState onRetry={() => void things.refetch()} /> : (
          <Card padding="none">
            {things.data.map((thing) => <ListRow key={thing.id} title={thing.name} onPress={() => router.push(`/w/${current.id}/things/${thing.id}`)} />)}
          </Card>
        )}
      </Screen>
    </>
  );
}
```

- Query keys are identical to the web (`["ws", wsId, "tests"]`, …) so invalidation
  behaves the same.
- Mutations: `try { await mutation.mutateAsync(); await queryClient.invalidateQueries(...); toast.success("…") } catch (error) { if (!handleMutationError(error)) toast.error(apiErrorMessage(error)); }`.
- Destructive actions: `if (!(await confirm({ title, message, confirmLabel: "Delete", destructive: true }))) return;`.
- Row menus: `showActionMenu([{ label: "Open", onSelect }, { label: "Delete", destructive: true, onSelect }])`.
- Forms: `react-hook-form` + `zod` with `Controller`; keep the web schema and
  error messages; use `Field` + `Input`; show root errors with `FormError`.
- Permissions: gate every action with `can("tests.manage")` etc., like the web.
- Dates: `formatDateTime(iso, timezone)`, `formatRelative(iso)`, `formatDuration(ms)`.
- Downloads: `shareTextFile(filename, text, mimeType)`; images: `expo-image` with
  `absoluteArtifactUrl(url)`.
- Deep-link/query params: read with `useLocalSearchParams()`; tokens through
  `parseLinkToken()`; never navigate to external URLs from params.
- Never persist workspace data; never log tokens or request bodies.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm lint
CI=1 pnpm exec expo export --platform ios --output-dir /tmp/zenguy-export   # bundle check
```
