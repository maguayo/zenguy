import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { register as registerAccount } from "../../api/auth";
import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { fieldError } from "../../components/ui/form";
import { useToast } from "../../contexts/ToastContext";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";

export const signUpSchema = z
  .object({
    acceptedTerms: z.boolean().refine(Boolean, "You must accept the Terms and Privacy Policy."),
    confirmPassword: z.string(),
    email: z.string().email("Enter a valid email address."),
    name: z.string().trim().min(1, "Name is required."),
    password: z.string().min(8, "Password must be at least 8 characters."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

type SignUpValues = z.infer<typeof signUpSchema>;

export default function SignUp() {
  const navigate = useNavigate();
  const toast = useToast();
  const form = useForm<SignUpValues>({
    defaultValues: {
      acceptedTerms: false,
      confirmPassword: "",
      email: "",
      name: "",
      password: "",
    },
    resolver: zodResolver(signUpSchema),
  });

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      await registerAccount(values.name, values.email, values.password);
      navigate("/check-email", { replace: true, state: { email: values.email } });
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        form.setError("root", { message: "An account with this email already exists." });
      } else {
        toast.error(apiErrorMessage(error));
      }
    }
  });

  return (
    <AuthShell
      description="Start free with the complete Zenguy plan. No card required."
      footer={
        <>
          Already have an account?{" "}
          <Link className="font-medium text-accent-700 hover:underline" to="/signin">
            Sign in
          </Link>
        </>
      }
      title="Create your account"
    >
      <form className="space-y-5" noValidate onSubmit={(event) => void submit(event)}>
        <Field error={fieldError(form.formState, "name")} htmlFor="signup-name" label="Name" required>
          <Input
            controlSize="lg"
            autoComplete="name"
            id="signup-name"
            invalid={Boolean(form.formState.errors.name)}
            placeholder="Ada Lovelace"
            {...form.register("name")}
          />
        </Field>
        <Field error={fieldError(form.formState, "email")} htmlFor="signup-email" label="Email" required>
          <Input
            controlSize="lg"
            autoComplete="email"
            id="signup-email"
            invalid={Boolean(form.formState.errors.email)}
            placeholder="you@company.com"
            type="email"
            {...form.register("email")}
          />
        </Field>
        <Field
          error={fieldError(form.formState, "password")}
          hint="At least 8 characters."
          htmlFor="signup-password"
          label="Password"
          required
        >
          <PasswordInput
            controlSize="lg"
            autoComplete="new-password"
            id="signup-password"
            invalid={Boolean(form.formState.errors.password)}
            {...form.register("password")}
          />
        </Field>
        <Field
          error={fieldError(form.formState, "confirmPassword")}
          htmlFor="signup-confirm-password"
          label="Confirm password"
          required
        >
          <PasswordInput
            controlSize="lg"
            autoComplete="new-password"
            id="signup-confirm-password"
            invalid={Boolean(form.formState.errors.confirmPassword)}
            {...form.register("confirmPassword")}
          />
        </Field>
        <div>
          <label className="flex items-start gap-2 text-sm text-zinc-600" htmlFor="signup-terms">
            <Checkbox
              className="mt-0.5"
              id="signup-terms"
              invalid={Boolean(form.formState.errors.acceptedTerms)}
              {...form.register("acceptedTerms")}
            />
            <span>
              I accept the{" "}
              <a className="font-medium text-accent-700 hover:underline" href="/terms/">
                Terms of Service
              </a>{" "}
              and{" "}
              <a className="font-medium text-accent-700 hover:underline" href="/privacy/">
                Privacy Policy
              </a>
            </span>
          </label>
          {form.formState.errors.acceptedTerms?.message ? (
            <p className="mt-1 text-xs text-danger-600" role="alert">
              {form.formState.errors.acceptedTerms.message}
            </p>
          ) : null}
        </div>
        {form.formState.errors.root?.message ? (
          <p
            className="rounded-md border border-danger-600/20 bg-danger-50 px-3 py-2 text-sm text-danger-700"
            role="alert"
          >
            {form.formState.errors.root.message}{" "}
            <Link className="font-medium underline" to="/signin">
              Sign in
            </Link>
          </p>
        ) : null}
        <Button className="w-full" loading={form.formState.isSubmitting} size="lg" type="submit" variant="primary">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
