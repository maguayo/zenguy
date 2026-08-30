import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { authReturnPath, prepareGoogleSignInUrl } from "../../api/auth";
import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { fieldError } from "../../components/ui/form";
import { useAuth } from "../../contexts/AuthContext";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";

export const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

type SignInValues = z.infer<typeof signInSchema>;

const GOOGLE_AUTH_ERRORS = {
  cancelled: "Google sign-in was cancelled. You can try again.",
  failed: "We couldn't sign you in with Google. Please try again.",
  link_required:
    "Use your Zenguy email and password. Google couldn't safely match this identity to a verified account.",
} as const;

export function googleAuthErrorMessage(value: string | null): string | null {
  if (value === null || !(value in GOOGLE_AUTH_ERRORS)) return null;
  return GOOGLE_AUTH_ERRORS[value as keyof typeof GOOGLE_AUTH_ERRORS];
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 18 18">
      <path
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.613Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.468-.806 5.956-2.182l-2.91-2.258c-.805.54-1.835.86-3.046.86-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.963 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}

interface GoogleSignInOptionProps {
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}

export function GoogleSignInOption({
  disabled,
  loading = false,
  onClick,
}: GoogleSignInOptionProps) {
  return (
    <>
      <Button
        aria-busy={loading}
        className="w-full"
        disabled={disabled}
        loading={loading}
        onClick={onClick}
        size="lg"
        type="button"
        variant="secondary"
      >
        <GoogleIcon />
        Continue with Google
      </Button>
      <div className="relative my-6" role="separator">
        <div aria-hidden="true" className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-zinc-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-2 text-xs text-zinc-500">or continue with email</span>
        </div>
      </div>
    </>
  );
}

export default function SignIn() {
  const { signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [googlePending, setGooglePending] = useState(false);
  const [oauthErrorDismissed, setOauthErrorDismissed] = useState(false);
  const form = useForm<SignInValues>({
    defaultValues: { email: "", password: "" },
    resolver: zodResolver(signInSchema),
  });
  const stateNext = (location.state as { next?: unknown } | null)?.next;
  const next = authReturnPath(stateNext, searchParams.get("next"));
  const oauthError = oauthErrorDismissed
    ? null
    : googleAuthErrorMessage(searchParams.get("oauth_error"));

  const startGoogleSignIn = async () => {
    setOauthErrorDismissed(true);
    form.clearErrors("root");
    setGooglePending(true);
    try {
      window.location.assign(await prepareGoogleSignInUrl(next));
    } catch (error) {
      setGooglePending(false);
      form.setError("root", { message: apiErrorMessage(error) });
    }
  };

  const submit = form.handleSubmit(async (values) => {
    setOauthErrorDismissed(true);
    form.clearErrors("root");
    try {
      await signIn(values.email, values.password);
      navigate(next, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_CREDENTIALS") {
        form.setError("root", { message: "Incorrect email or password." });
      } else if (error instanceof ApiError && error.code === "RATE_LIMITED") {
        form.setError("root", { message: "Too many attempts. Try again in a moment." });
      } else {
        // A blocking form action reports failure inline; a transient toast is
        // easy to miss and leaves the form looking like nothing happened.
        form.setError("root", { message: apiErrorMessage(error) });
      }
    }
  });

  return (
    <AuthShell
      description="Sign in to your workspace."
      footer={
        <>
          Don't have an account?{" "}
          <Link className="font-medium text-accent-700 hover:underline" to="/signup">
            Sign up
          </Link>
        </>
      }
      title="Welcome back"
    >
      <GoogleSignInOption
        disabled={form.formState.isSubmitting}
        loading={googlePending}
        onClick={() => void startGoogleSignIn()}
      />
      <form className="space-y-5" noValidate onSubmit={(event) => void submit(event)}>
        <Field
          error={fieldError(form.formState, "email")}
          htmlFor="signin-email"
          label="Email"
          required
        >
          <Input
            controlSize="lg"
            autoComplete="email"
            disabled={googlePending}
            id="signin-email"
            invalid={Boolean(form.formState.errors.email)}
            placeholder="you@company.com"
            type="email"
            {...form.register("email")}
          />
        </Field>
        <Field
          error={fieldError(form.formState, "password")}
          htmlFor="signin-password"
          label="Password"
          required
        >
          <PasswordInput
            controlSize="lg"
            autoComplete="current-password"
            disabled={googlePending}
            id="signin-password"
            invalid={Boolean(form.formState.errors.password)}
            {...form.register("password")}
          />
        </Field>
        {form.formState.errors.root?.message || oauthError ? (
          <p
            className="rounded-md border border-danger-600/20 bg-danger-50 px-3 py-2 text-sm text-danger-700"
            role="alert"
          >
            {form.formState.errors.root?.message ?? oauthError}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Link className="text-sm font-medium text-accent-700 hover:underline" to="/forgot-password">
            Forgot password?
          </Link>
        </div>
        <Button
          className="w-full"
          disabled={googlePending}
          loading={form.formState.isSubmitting}
          size="lg"
          type="submit"
          variant="primary"
        >
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
