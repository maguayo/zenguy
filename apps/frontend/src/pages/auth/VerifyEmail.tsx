import { zodResolver } from "@hookform/resolvers/zod";
import { useLayoutEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";

import {
  verifyEmail as verifyEmailRequest,
  type AuthSession,
} from "../../api/auth";
import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Spinner } from "../../components/ui/Spinner";
import { fieldError } from "../../components/ui/form";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { ApiError } from "../../lib/api";
import { trackVerifiedSignUpSuccess } from "../../lib/analytics/ga4";
import {
  parseUrlCapability,
  parseUrlCapabilityFragment,
  redactCurrentUrlCapability,
} from "../../lib/url-capabilities";
import { useResendVerification } from "./useResendVerification";

export const verificationEmailSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});
export const verificationPasswordSchema = z.object({
  password: z
    .string()
    .min(1, "Enter the password used to create this account."),
});

type VerificationEmailValues = z.infer<typeof verificationEmailSchema>;
type VerificationPasswordValues = z.infer<typeof verificationPasswordSchema>;
type VerificationState = "ready" | "loading" | "gone" | "error";

export async function adoptVerifiedEmailSession(
  session: AuthSession,
  adoptSession: (session: AuthSession) => Promise<void>,
  trackSignUp: typeof trackVerifiedSignUpSuccess = trackVerifiedSignUpSuccess,
): Promise<void> {
  await adoptSession(session);
  await trackSignUp(session.user);
}

/** Reachable signed in or signed out: the link in the email carries no session. */
export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [token] = useState(
    () =>
      parseUrlCapabilityFragment(location.hash) ||
      parseUrlCapability(searchParams.get("token")),
  );
  const { adoptSession } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState<VerificationState>(token ? "ready" : "gone");
  const emailForm = useForm<VerificationEmailValues>({
    defaultValues: { email: "" },
    resolver: zodResolver(verificationEmailSchema),
  });
  const passwordForm = useForm<VerificationPasswordValues>({
    defaultValues: { password: "" },
    resolver: zodResolver(verificationPasswordSchema),
  });
  const email = emailForm.watch("email");
  const { countdown, resend, sending } = useResendVerification(email);

  useLayoutEffect(() => {
    if (location.hash || searchParams.has("token")) {
      redactCurrentUrlCapability("token");
    }
  }, [location.hash, searchParams]);

  const verify = passwordForm.handleSubmit(async ({ password }) => {
    if (!token) {
      setState("gone");
      return;
    }
    passwordForm.clearErrors();
    setState("loading");
    try {
      const session = await verifyEmailRequest(token, password);
      await adoptVerifiedEmailSession(session, adoptSession);
      toast.success("Email verified");
      navigate("/", { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === "GONE") {
        setState("gone");
      } else if (
        error instanceof ApiError &&
        error.code === "INVALID_CREDENTIALS"
      ) {
        setState("ready");
        passwordForm.setError("password", {
          message: "That is not the password used to create this account.",
        });
      } else if (
        error instanceof ApiError &&
        error.code === "RATE_LIMITED"
      ) {
        setState("ready");
        passwordForm.setError("root", {
          message: "Too many attempts. Try again in a moment.",
        });
      } else {
        setState("error");
      }
    }
  });

  if (state === "loading") {
    return (
      <AuthShell title="Verifying your email">
        <div className="grid min-h-24 place-items-center">
          <Spinner label="Verifying email" size={5} />
        </div>
      </AuthShell>
    );
  }

  if (state === "error") {
    return (
      <AuthShell title="Verify your email">
        <ErrorState onRetry={() => setState(token ? "ready" : "gone")} />
      </AuthShell>
    );
  }

  if (state === "ready") {
    return (
      <AuthShell
        description="Enter the password you chose when creating this account. The email link alone cannot activate it."
        title="Verify your email"
      >
        <form
          className="space-y-5"
          noValidate
          onSubmit={(event) => void verify(event)}
        >
          <Field
            error={fieldError(passwordForm.formState, "password")}
            htmlFor="verification-password"
            label="Password"
            required
          >
            <PasswordInput
              autoComplete="current-password"
              autoFocus
              controlSize="lg"
              id="verification-password"
              invalid={Boolean(passwordForm.formState.errors.password)}
              {...passwordForm.register("password")}
            />
          </Field>
          {passwordForm.formState.errors.root?.message ? (
            <p
              className="rounded-md border border-danger-600/20 bg-danger-50 px-3 py-2 text-sm text-danger-700"
              role="alert"
            >
              {passwordForm.formState.errors.root.message}
            </p>
          ) : null}
          <Button
            className="w-full"
            loading={passwordForm.formState.isSubmitting}
            size="lg"
            type="submit"
            variant="primary"
          >
            Verify email
          </Button>
        </form>
      </AuthShell>
    );
  }

  const submit = emailForm.handleSubmit(async () => resend());
  return (
    <AuthShell
      description="This verification link is invalid or has expired."
      title="Verify your email"
    >
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <Field
          error={fieldError(emailForm.formState, "email")}
          htmlFor="verification-email"
          label="Email"
          required
        >
          <Input
            autoComplete="email"
            id="verification-email"
            invalid={Boolean(emailForm.formState.errors.email)}
            type="email"
            {...emailForm.register("email")}
          />
        </Field>
        <Button
          className="w-full"
          disabled={countdown > 0}
          loading={sending}
          type="submit"
          variant="primary"
        >
          {countdown > 0 ? `Resend email in ${countdown}s` : "Resend verification"}
        </Button>
      </form>
    </AuthShell>
  );
}
