import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { ApiError, SESSION_QUERY_KEY, api } from "../api";

export interface Credentials {
  email: string;
  password: string;
}

export interface LoginFormProps {
  error: string | null;
  onSubmit: (credentials: Credentials) => void;
  pending: boolean;
}

/** Turns a failed login into the one line the operator needs to act on. */
export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Invalid credentials";
    if (error.status === 429) return "Too many attempts, try again later";
    if (error.status === 503) return "Production API is not reachable";
  }
  return error instanceof Error ? error.message : "Something went wrong";
}

const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400";

export function LoginForm({ error, onSubmit, pending }: LoginFormProps) {
  return (
    <form
      className="rounded-lg border border-zinc-200 bg-white p-6"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        onSubmit({
          email: String(fields.get("email") ?? ""),
          password: String(fields.get("password") ?? ""),
        });
      }}
    >
      <h1 className="text-xl font-semibold">Zenguy Admin</h1>
      <p className="mt-1 text-zinc-500">
        Internal platform panel — sign in with your Zenguy account
      </p>

      <label className="mt-6 block" htmlFor="email">
        <span className="mb-1 block font-medium text-zinc-700">Email</span>
        <input
          autoComplete="username"
          className={inputClass}
          id="email"
          name="email"
          placeholder="you@zenguy.com"
          required
          type="email"
        />
      </label>

      <label className="mt-4 block" htmlFor="password">
        <span className="mb-1 block font-medium text-zinc-700">Password</span>
        <input
          autoComplete="current-password"
          className={inputClass}
          id="password"
          name="password"
          required
          type="password"
        />
      </label>

      {error ? (
        <p className="mt-4 rounded-md bg-danger-50 px-3 py-2 text-danger-700" role="alert">
          {error}
        </p>
      ) : null}

      <button
        className="mt-6 h-9 w-full rounded-md bg-accent-600 px-3 font-medium text-white hover:bg-accent-700 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useMutation({
    mutationFn: (credentials: Credentials) => api.login(credentials.email, credentials.password),
    onSuccess: (session) => {
      // Seed the session gate so the dashboard renders without a second round trip.
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      navigate("/", { replace: true });
    },
  });

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <LoginForm
          error={login.isError ? loginErrorMessage(login.error) : null}
          onSubmit={(credentials) => login.mutate(credentials)}
          pending={login.isPending}
        />
      </div>
    </main>
  );
}
