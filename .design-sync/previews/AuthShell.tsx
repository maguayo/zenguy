import { AuthShell, Button, Field, Input, PasswordInput } from "@zenguy/frontend";

export const SignIn = () => (
  <AuthShell
    description="Sign in to keep an eye on your tests and monitors."
    footer={
      <p>
        New to Zenguy?{" "}
        <a className="font-medium text-accent-700 hover:underline" href="#create-account">
          Create an account
        </a>
      </p>
    }
    title="Welcome back"
  >
    <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
      <Field htmlFor="auth-email" label="Email">
        <Input defaultValue="marcos@aurora-plants.com" id="auth-email" type="email" />
      </Field>
      <Field htmlFor="auth-password" label="Password">
        <PasswordInput defaultValue="correct-horse-battery" id="auth-password" />
      </Field>
      <Button className="w-full" variant="primary">
        Sign in
      </Button>
      <p className="text-center text-sm">
        <a className="text-zinc-500 hover:text-zinc-700 hover:underline" href="#forgot">
          Forgot your password?
        </a>
      </p>
    </form>
  </AuthShell>
);

export const ForgotPassword = () => (
  <AuthShell
    description="Enter your account email and we'll send you a reset link."
    footer={
      <p>
        Remembered it?{" "}
        <a className="font-medium text-accent-700 hover:underline" href="#signin">
          Back to sign in
        </a>
      </p>
    }
    title="Reset your password"
  >
    <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
      <Field
        hint="We'll only send a link if this address has a Zenguy account."
        htmlFor="reset-email"
        label="Email"
      >
        <Input id="reset-email" placeholder="you@company.com" type="email" />
      </Field>
      <Button className="w-full" variant="primary">
        Send reset link
      </Button>
    </form>
  </AuthShell>
);
