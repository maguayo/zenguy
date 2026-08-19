import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { fieldError } from "../../components/ui/form";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";

export const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

type SignInValues = z.infer<typeof signInSchema>;

export default function SignIn() {
  const { signIn } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const form = useForm<SignInValues>({
    defaultValues: { email: "", password: "" },
    resolver: zodResolver(signInSchema),
  });

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      await signIn(values.email, values.password);
      const next = (location.state as { next?: string } | null)?.next ?? "/";
      navigate(next, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_CREDENTIALS") {
        form.setError("root", { message: "Incorrect email or password." });
      } else if (error instanceof ApiError && error.code === "RATE_LIMITED") {
        form.setError("root", { message: "Too many attempts. Try again in a moment." });
      } else {
        toast.error(apiErrorMessage(error));
      }
    }
  });

  return (
    <AuthShell
      footer={
        <>
          Don't have an account?{" "}
          <Link className="font-medium text-accent-700 hover:underline" to="/signup">
            Sign up
          </Link>
        </>
      }
      title="Sign in"
    >
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <Field
          error={fieldError(form.formState, "email")}
          htmlFor="signin-email"
          label="Email"
          required
        >
          <Input
            autoComplete="email"
            id="signin-email"
            invalid={Boolean(form.formState.errors.email)}
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
          <Input
            autoComplete="current-password"
            id="signin-password"
            invalid={Boolean(form.formState.errors.password)}
            type="password"
            {...form.register("password")}
          />
        </Field>
        {form.formState.errors.root?.message ? (
          <p className="text-sm text-danger-600" role="alert">
            {form.formState.errors.root.message}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Link className="text-sm font-medium text-accent-700 hover:underline" to="/forgot-password">
            Forgot password?
          </Link>
        </div>
        <Button className="w-full" loading={form.formState.isSubmitting} type="submit" variant="primary">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
