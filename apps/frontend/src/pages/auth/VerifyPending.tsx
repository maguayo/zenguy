import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { fieldError } from "../../components/ui/form";
import { useAuth } from "../../contexts/AuthContext";
import { useResendVerification } from "./useResendVerification";

const POLL_INTERVAL_MS = 10_000;

export const pendingVerificationSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});

type PendingVerificationValues = z.infer<typeof pendingVerificationSchema>;

/** Public/token-free after registration; legacy signed-in users also keep polling. */
export default function VerifyPending() {
  const { refreshUser, signOut, status, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const stateEmail = (location.state as { email?: unknown } | null)?.email;
  const form = useForm<PendingVerificationValues>({
    defaultValues: {
      email:
        user?.email ?? (typeof stateEmail === "string" ? stateEmail : ""),
    },
    resolver: zodResolver(pendingVerificationSchema),
  });
  const email = form.watch("email");
  const { countdown, resend, sending } = useResendVerification(email);
  const signedIn = status === "signedIn" && user !== null;

  useEffect(() => {
    if (status !== "signedIn" || user === null || user.emailVerified) {
      return undefined;
    }
    let polling = false;
    const check = () => {
      if (polling) return;
      polling = true;
      void refreshUser()
        .then((nextUser) => {
          if (nextUser.emailVerified) navigate("/", { replace: true });
        })
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    };
    const timer = window.setInterval(check, POLL_INTERVAL_MS);
    // Coming back from the mail client is when the link was most likely used.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [navigate, refreshUser, signedIn, user?.emailVerified]);

  const submit = form.handleSubmit(async () => resend());

  return (
    <AuthShell
      description={
        email.length > 0 ? (
          <>
            We sent a verification link to{" "}
            <span className="font-medium text-zinc-700">{email}</span>.
          </>
        ) : (
          "Enter your email to resend the verification link."
        )
      }
      footer={
        signedIn ? (
          <button
            className="font-medium text-accent-700 hover:underline"
            type="button"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        ) : (
          <Link className="font-medium text-accent-700 hover:underline" to="/signin">
            Sign in
          </Link>
        )
      }
      title="Verify your email"
    >
      <p className="mb-4 text-sm text-zinc-600">
        Open the link, then enter the password you chose during registration.
      </p>
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <Field
          error={fieldError(form.formState, "email")}
          htmlFor="pending-verification-email"
          label="Email"
          required
        >
          <Input
            autoComplete="email"
            id="pending-verification-email"
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
        >
          {countdown > 0 ? `Resend email in ${countdown}s` : "Resend email"}
        </Button>
      </form>
    </AuthShell>
  );
}
