import { QueryCache, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { ApiError, SESSION_QUERY_KEY, api } from "./api";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Transient failures are worth another try; an expired session never is. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return !isUnauthorized(error) && failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, retry: shouldRetryQuery },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      // The session gate turns its own 401 into an in-app redirect. A 401 from a
      // data query means the cookie expired while the panel was open, so reboot
      // the app on /login instead of leaving stale numbers on screen.
      if (!isUnauthorized(error)) return;
      if (query.queryKey[0] === SESSION_QUERY_KEY[0]) return;
      if (window.location.pathname === "/login") return;
      window.location.assign("/login");
    },
  }),
});

function CenteredNotice({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center px-4 text-zinc-500">{children}</div>;
}

function RequireSession() {
  const session = useQuery({ queryFn: api.me, queryKey: SESSION_QUERY_KEY, retry: false });

  if (session.isPending) return <CenteredNotice>Checking session…</CenteredNotice>;
  if (isUnauthorized(session.error)) return <Navigate replace to="/login" />;
  if (session.isError) {
    return (
      <CenteredNotice>
        <div className="text-center">
          <p>The panel could not check your session.</p>
          <button
            className="mt-3 h-9 rounded-md border border-zinc-300 bg-white px-3 font-medium text-zinc-700"
            onClick={() => void session.refetch()}
            type="button"
          >
            Try again
          </button>
        </div>
      </CenteredNotice>
    );
  }
  return <DashboardPage email={session.data.email} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<LoginPage />} path="/login" />
          <Route element={<RequireSession />} path="/" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
