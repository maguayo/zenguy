import type { ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ToastProvider } from "./contexts/ToastContext";

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

function Placeholder({ label }: { label: string }) {
  return (
    <main className="grid min-h-screen place-items-center">
      <h1 className="text-2xl font-semibold">{label}</h1>
    </main>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route element={<Placeholder label="Sign in" />} path="/signin" />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<Placeholder label="Verify your email" />} path="/verify-pending" />
        <Route element={<Placeholder label="Zenguy" />} path="/" />
      </Route>
      <Route element={<Placeholder label="Not found" />} path="*" />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
