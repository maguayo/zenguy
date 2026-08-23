import { zodResolver } from "@hookform/resolvers/zod";
import { useLayoutEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { resetPassword } from "../../api/auth";
import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { fieldError } from "../../components/ui/form";
import { useToast } from "../../contexts/ToastContext";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";
import {
  parseUrlCapability,
  parseUrlCapabilityFragment,
  redactCurrentUrlCapability,
} from "../../lib/url-capabilities";
import {
  isAcceptableNewPassword,
  MIN_PASSWORD_LENGTH,
} from "../../lib/password-policy";

export const resetPasswordSchema = z
  .object({
    confirmPassword: z.string(),
    password: z
      .string()
      .min(
        MIN_PASSWORD_LENGTH,
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      )
      .refine(
        isAcceptableNewPassword,
        "Choose a password that is not commonly compromised.",
      ),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [token] = useState(
    () =>
      parseUrlCapabilityFragment(location.hash) ||
      parseUrlCapability(searchParams.get("token")),
  );
  const toast = useToast();
  const [state, setState] = useState<"form" | "success" | "gone">(token ? "form" : "gone");
  const form = useForm<ResetPasswordValues>({
    defaultValues: { confirmPassword: "", password: "" },
    resolver: zodResolver(resetPasswordSchema),
  });

  useLayoutEffect(() => {
    if (location.hash || searchParams.has("token")) {
      redactCurrentUrlCapability("token");
    }
  }, [location.hash, searchParams]);

  const submit = form.handleSubmit(async ({ password }) => {
    try {
      await resetPassword(token, password);
      setState("success");
    } catch (error) {
      if (error instanceof ApiError && error.code === "GONE") setState("gone");
      else toast.error(apiErrorMessage(error));
    }
  });

  if (state === "success") {
    return (
      <AuthShell
        description="Password updated. Sign in with your new password."
        title="Password updated"
      >
        <Link
          className="inline-flex h-9 w-full items-center justify-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
          to="/signin"
        >
          Sign in
        </Link>
      </AuthShell>
    );
  }

  if (state === "gone") {
    return (
      <AuthShell
        description="This reset link is invalid or has expired."
        title="Reset link expired"
      >
        <Link className="font-medium text-accent-700 hover:underline" to="/forgot-password">
          Request a new reset link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <Field
          error={fieldError(form.formState, "password")}
          htmlFor="reset-password"
          label="New password"
          required
        >
          <Input
            autoComplete="new-password"
            id="reset-password"
            invalid={Boolean(form.formState.errors.password)}
            type="password"
            {...form.register("password")}
          />
        </Field>
        <Field
          error={fieldError(form.formState, "confirmPassword")}
          htmlFor="reset-confirm-password"
          label="Confirm password"
          required
        >
          <Input
            autoComplete="new-password"
            id="reset-confirm-password"
            invalid={Boolean(form.formState.errors.confirmPassword)}
            type="password"
            {...form.register("confirmPassword")}
          />
        </Field>
        <Button className="w-full" loading={form.formState.isSubmitting} type="submit" variant="primary">
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
