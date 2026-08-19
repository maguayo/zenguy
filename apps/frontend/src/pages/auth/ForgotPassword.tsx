import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";

import { forgotPassword } from "../../api/auth";
import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { fieldError } from "../../components/ui/form";
import { useToast } from "../../contexts/ToastContext";
import { apiErrorMessage } from "../../lib/errors";

export const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
  const toast = useToast();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<ForgotPasswordValues>({
    defaultValues: { email: "" },
    resolver: zodResolver(forgotPasswordSchema),
  });

  const submit = form.handleSubmit(async ({ email }) => {
    try {
      await forgotPassword(email);
      setSentTo(email);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  });

  if (sentTo) {
    return (
      <AuthShell
        description={
          <>
            If an account exists for <span className="font-medium text-zinc-700">{sentTo}</span>, we've sent a reset link.
          </>
        }
        footer={
          <Link className="font-medium text-accent-700 hover:underline" to="/signin">
            Back to sign in
          </Link>
        }
        title="Check your inbox"
      >
        <p className="text-center text-sm text-zinc-500">The link expires for your security.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      description="Enter your email and we'll send you a reset link."
      footer={
        <Link className="font-medium text-accent-700 hover:underline" to="/signin">
          Back to sign in
        </Link>
      }
      title="Forgot password?"
    >
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <Field error={fieldError(form.formState, "email")} htmlFor="forgot-email" label="Email" required>
          <Input
            autoComplete="email"
            id="forgot-email"
            invalid={Boolean(form.formState.errors.email)}
            type="email"
            {...form.register("email")}
          />
        </Field>
        <Button className="w-full" loading={form.formState.isSubmitting} type="submit" variant="primary">
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
