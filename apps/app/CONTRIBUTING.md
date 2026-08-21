# Contributing to the Zenguy iOS app

This package mirrors `apps/frontend` screen by screen. Before touching a
screen, read its web counterpart under `apps/frontend/src/pages/**` and port the
behaviour, copy and validation faithfully; only the presentation changes.

## Layout

- `app/` — expo-router routes. URLs match the web app (`/w/[wsId]/tests/[testId]`,
  `/w/[wsId]/runs/[runId]`, …). Tab groups (`(overview)`, `(tests)`, `(uptime)`,
  `(incidents)`, `(more)`) are each a native stack; `(more)` hosts Notifications,
  Secrets, Members, Plan & Usage, Settings and Account.
- `src/api/` — resource clients and `types.ts` (ported verbatim from the web).
- `src/lib/` — `api.ts` (fetch + bearer + Keychain refresh), `format.ts`,
  `errors.ts`, `permissions.ts`, `links.ts`, `share.ts`, `timezones.ts`,
  `stack-options.ts`.
- `src/contexts/` — `useAuth()`, `useWorkspace()`, `useToast()`, `useAppLock()`.
- `src/hooks/` — `useMutationError()` (403/402 handling), `useResendVerification()`.
- `src/ui/` — primitives: `Screen`, `Card`, `Button`, `Input`, `PasswordInput`,
  `Field`, `Badge`, `ListRow`, `EmptyState`, `ErrorState`, `Spinner`, `Skeleton`,
  `SegmentedTabs`, `SelectSheet`, `Toggle`, `DescriptionList`, `ActionMenu`
  (`showActionMenu`), `confirm()`, `LoadMore`, text variants (`Title`, `Heading`,
  `Body`, `Small`, `Muted`, `Caption`, `Label`, `Mono`).
- `src/components/` — domain components (`StatusBadge`, `RunSourceBadge`,
  `UsageMeter`, `ChannelPicker`, `TimezonePicker`, `CopyButton`, `RoleBadge`,
  `FormError`, `AuthShell`, …).
- `src/theme/` — colours, spacing, radius, typography, tones.

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
