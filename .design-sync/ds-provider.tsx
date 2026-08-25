// Preview/design harness provider for design-sync cards and Claude Design
// output: gives components the router, react-query, toast, auth, and workspace
// contexts they read in the app. Contexts are imported RELATIVELY from the app
// source so they compile into the same bundle module graph as the components
// (a separate copy would create second context instances the components can't
// see). Queries never retry so cards settle instead of erroring.
//
// The fetch mock below answers ONLY the exact Zenguy API paths the shell
// components need to mount (there is no backend in preview or design runtime);
// every other request passes through untouched.
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../apps/frontend/src/contexts/AuthContext";
import { ToastProvider } from "../apps/frontend/src/contexts/ToastContext";
import { WorkspaceProvider } from "../apps/frontend/src/contexts/WorkspaceContext";

const demoUser = {
  createdAt: "2024-01-08T09:00:00.000Z",
  email: "maya@acme.dev",
  emailVerified: true,
  id: "usr_demo",
  name: "Maya Ortiz",
};

const demoWorkspace = {
  createdAt: "2024-01-08T09:05:00.000Z",
  id: "ws_demo",
  name: "Acme QA",
  role: "OWNER",
  slug: "acme-qa",
  subscriptionStatus: "ACTIVE",
  timezone: "Europe/Madrid",
};

function demoResponse(body: unknown): Response {
  return new Response(JSON.stringify({ data: body }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

if (typeof window !== "undefined" && typeof window.fetch === "function") {
  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (path === "/api/auth/refresh") {
      return Promise.resolve(
        demoResponse({ accessToken: "ds-demo-token", expiresIn: 3600, user: demoUser }),
      );
    }
    if (path === "/api/workspaces") {
      return Promise.resolve(demoResponse([demoWorkspace]));
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export function DSProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      }),
  );
  return (
    <MemoryRouter initialEntries={["/w/ws_demo/overview"]}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route
                element={<WorkspaceProvider>{children}</WorkspaceProvider>}
                path="/w/:wsId/*"
              />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
