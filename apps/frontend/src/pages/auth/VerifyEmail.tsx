import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { verifyEmail as verifyEmailRequest } from "../../api/auth";
import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { fieldError } from "../../components/ui/form";
import { ApiError } from "../../lib/api";
import { useResendVerification } from "./useResendVerification";

export const verificationEmailSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});

type VerificationEmailValues = z.infer<typeof verificationEmailSchema>;
type VerificationState = "loading" | "success" | "gone" | "error";

export function createTokenVerifier(
  verify: (token: string) => Promise<unknown>,
): (token: string) => Promise<void> {
  const requests = new Map<string, Promise<void>>();
  return (token) => {
    const existing = requests.get(token);
    if (existing) return existing;
    const request = verify(token)
      .then(() => undefined)
      .catch((error: unknown) => {
        requests.delete(token);
        throw error;
      });
    requests.set(token, request);
    return request;
  };
}

const verifyEmailOnce = createTokenVerifier(verifyEmailRequest);

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<VerificationState>("loading");
  const [attempt, setAttempt] = useState(0);
  const form = useForm<VerificationEmailValues>({
    defaultValues: { email: "" },
    resolver: zodResolver(verificationEmailSchema),
  });
  const email = form.watch("email");
  const { countdown, resend, sending } = useResendVerification(email);

  useEffect(() => {
    let active = true;
    if (!token) {
      setState("gone");
      return () => {
        active = false;
      };
    }
    setState("loading");
    void verifyEmailOnce(token)
      .then(() => {
        if (active) setState("success");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(error instanceof ApiError && error.code === "GONE" ? "gone" : "error");
      });
    return () => {
      active = false;
    };
  }, [attempt, token]);

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
        <ErrorState onRetry={() => setAttempt((current) => current + 1)} />
      </AuthShell>
    );
  }

  if (state === "success") {
    return (
      <AuthShell description="Your email address is ready to use." title="Email verified">
        <Link
          className="inline-flex h-9 w-full items-center justify-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
          to="/signin"
        >
          Sign in
        </Link>
      </AuthShell>
    );
  }

  const submit = form.handleSubmit(async () => resend());
  return (
    <AuthShell
      description="This verification link is invalid or has expired."
      title="Verify your email"
    >
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <Field
          error={fieldError(form.formState, "email")}
          htmlFor="verification-email"
          label="Email"
          required
        >
          <Input
            autoComplete="email"
            id="verification-email"
            invalid={Boolean(form.formState.errors.email)}
            type="email"
            {...form.register("email")}
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
