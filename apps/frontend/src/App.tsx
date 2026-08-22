import {
  Component,
  Suspense,
  lazy,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";

import type { Workspace } from "./api/types";
import { AppLayout } from "./components/AppLayout";
import { ErrorState } from "./components/ui/ErrorState";
import { Spinner } from "./components/ui/Spinner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ToastProvider } from "./contexts/ToastContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import { ApiError, apiGet } from "./lib/api";

const stub = (title: string) =>
  lazy(async () => {
    const { StubPage } = await import("./pages/StubPage");
    return { default: () => <StubPage title={title} /> };
  });

const SignIn = lazy(() => import("./pages/auth/SignIn"));
const SignUp = lazy(() => import("./pages/auth/SignUp"));
const VerifyEmail = lazy(() => import("./pages/auth/VerifyEmail"));
const ForgotPassword = lazy(() => import("./pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));
const AcceptInvitation = lazy(() => import("./pages/auth/AcceptInvitation"));
const VerifyPending = lazy(() => import("./pages/auth/VerifyPending"));
const CreateWorkspace = lazy(() => import("./pages/onboarding/CreateWorkspace"));
const BillingSetup = lazy(() => import("./pages/onboarding/BillingSetup"));
const OverviewPage = lazy(() => import("./pages/overview/OverviewPage"));
const TestsListPage = lazy(() => import("./pages/tests/TestsListPage"));
const NewTestPage = lazy(() => import("./pages/tests/TestFormPage"));
const TestDetailPage = lazy(() => import("./pages/tests/TestDetailPage"));
const EditTestPage = lazy(() => import("./pages/tests/TestFormPage"));
const RunDetailPage = lazy(() => import("./pages/tests/RunDetailPage"));
const UptimeListPage = lazy(() => import("./pages/uptime/UptimeListPage"));
const NewMonitorPage = lazy(() => import("./pages/uptime/MonitorFormPage"));
const MonitorDetailPage = lazy(() => import("./pages/uptime/MonitorDetailPage"));
const EditMonitorPage = lazy(() => import("./pages/uptime/MonitorFormPage"));
const IncidentsPage = lazy(() => import("./pages/incidents/IncidentsPage"));
const IncidentDetailPage = lazy(() => import("./pages/incidents/IncidentDetailPage"));
const ChannelsPage = lazy(() => import("./pages/notifications/ChannelsPage"));
const PaidAlertsPage = lazy(() => import("./pages/alerts/PaidAlertsPage"));
const SecretsPage = lazy(() => import("./pages/secrets/SecretsPage"));
const MembersPage = lazy(() => import("./pages/members/MembersPage"));
const BillingPage = lazy(() => import("./pages/billing/BillingPage"));
const RedeemGrant = lazy(() => import("./pages/billing/RedeemGrant"));
const IssueGrants = lazy(() => import("./pages/billing/IssueGrants"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const Privacy = lazy(() => import("./pages/legal/Privacy"));
const Terms = lazy(() => import("./pages/legal/Terms"));
const NotFound = lazy(() => import("./pages/NotFound"));

export function shouldRetryQuery(count: number, error: unknown): boolean {
  return !(error instanceof ApiError && error.status < 500) && count < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: shouldRetryQuery,
      staleTime: 10_000,
    },
  },
});

export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === "signedOut") {
    return <Navigate replace state={{ next: `${location.pathname}${location.search}` }} to="/signin" />;
  }
  if (user && !user.emailVerified && location.pathname !== "/verify-pending") {
    return <Navigate replace to="/verify-pending" />;
  }
  return <>{children ?? <Outlet />}</>;
}

export function PublicOnly({ children }: { children?: ReactNode }) {
  const { status } = useAuth();
  if (status === "signedIn") return <Navigate replace to="/" />;
  return <>{children ?? <Outlet />}</>;
}

/** `/notifications` moved to `/alerts`; keep old links and panel query params working. */
export function LegacyNotificationsRedirect() {
  const location = useLocation();
  return <Navigate replace to={{ pathname: "../alerts", search: location.search }} />;
}

function RouteLoading() {
  return (
    <div className="grid min-h-64 place-items-center">
      <Spinner label="Loading page" size={5} />
    </div>
  );
}

function WorkspaceShell() {
  return (
    <WorkspaceProvider>
      <AppLayout />
    </WorkspaceProvider>
  );
}

function RootResolver() {
  const { status, user } = useAuth();
  const verified = status === "signedIn" && Boolean(user?.emailVerified);
  const workspaces = useQuery({
    enabled: verified,
    queryFn: () => apiGet<Workspace[]>("/api/workspaces"),
    queryKey: ["workspaces"],
  });

  if (status === "signedOut") return <Navigate replace to="/signin" />;
  if (!verified) return <Navigate replace to="/verify-pending" />;
  if (workspaces.isPending) return <RouteLoading />;
  if (workspaces.isError) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <ErrorState onRetry={() => void workspaces.refetch()} />
      </main>
    );
  }
  if (workspaces.data.length === 0) {
    return <Navigate replace to="/onboarding/workspace" />;
  }

  const lastId = localStorage.getItem("zenguy:lastWorkspace");
  const workspace = workspaces.data.find((item) => item.id === lastId) ?? workspaces.data[0];
  if (!workspace) return <Navigate replace to="/onboarding/workspace" />;
  return <Navigate replace to={`/w/${workspace.id}/overview`} />;
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route element={<SignIn />} path="/signin" />
          <Route element={<SignUp />} path="/signup" />
          <Route element={<ForgotPassword />} path="/forgot-password" />
          <Route element={<ResetPassword />} path="/reset-password" />
        </Route>
        <Route element={<VerifyEmail />} path="/verify-email" />
        <Route element={<AcceptInvitation />} path="/invitations/:token" />
        <Route element={<RedeemGrant />} path="/grants/:token" />
        <Route element={<Privacy />} path="/privacy" />
        <Route element={<Terms />} path="/terms" />

        <Route element={<RequireAuth />}>
          <Route element={<VerifyPending />} path="/verify-pending" />
          <Route element={<IssueGrants />} path="/complimentary" />
          <Route element={<CreateWorkspace />} path="/onboarding/workspace" />
          <Route element={<BillingSetup />} path="/w/:wsId/setup/billing" />
          <Route element={<WorkspaceShell />} path="/w/:wsId">
            <Route element={<Navigate replace to="overview" />} index />
            <Route element={<OverviewPage />} path="overview" />
            <Route element={<TestsListPage />} path="tests" />
            <Route element={<NewTestPage />} path="tests/new" />
            <Route element={<TestDetailPage />} path="tests/:testId" />
            <Route element={<EditTestPage />} path="tests/:testId/edit" />
            <Route element={<RunDetailPage />} path="runs/:runId" />
            <Route element={<UptimeListPage />} path="uptime" />
            <Route element={<NewMonitorPage />} path="uptime/new" />
            <Route element={<MonitorDetailPage />} path="uptime/:monitorId" />
            <Route element={<EditMonitorPage />} path="uptime/:monitorId/edit" />
            <Route element={<IncidentsPage />} path="incidents" />
            <Route element={<IncidentDetailPage />} path="incidents/:incidentId" />
            <Route element={<ChannelsPage />} path="alerts" />
            <Route element={<PaidAlertsPage />} path="alerts/sms-calls" />
            <Route element={<LegacyNotificationsRedirect />} path="notifications" />
            <Route element={<SecretsPage />} path="secrets" />
            <Route element={<MembersPage />} path="members" />
            <Route element={<BillingPage />} path="billing" />
            <Route element={<SettingsPage />} path="settings" />
          </Route>
        </Route>

        <Route element={<RootResolver />} path="/" />
        <Route element={<NotFound />} path="*" />
      </Routes>
    </Suspense>
  );
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The UI remains safe and recoverable; production observability captures window errors.
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="mx-auto max-w-xl px-4 py-12">
          <ErrorState
            message="The application couldn't load this page."
            onRetry={() => window.location.reload()}
            retryLabel="Reload"
          />
        </main>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
