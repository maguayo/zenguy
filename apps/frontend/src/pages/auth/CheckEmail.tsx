import { Link, useLocation } from "react-router-dom";

import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { useResendVerification } from "./useResendVerification";

export default function CheckEmail() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email ?? "your email address";
  const { countdown, resend, sending } = useResendVerification(
    email === "your email address" ? "" : email,
  );

  return (
    <AuthShell
      description={
        <>
          We sent a verification link to <span className="font-medium text-zinc-700">{email}</span>.
        </>
      }
      footer={
        <Link className="font-medium text-accent-700 hover:underline" to="/signin">
          Back to sign in
        </Link>
      }
      title="Check your inbox"
    >
      <Button
        className="w-full"
        disabled={!email || email === "your email address" || countdown > 0}
        loading={sending}
        onClick={() => void resend()}
      >
        {countdown > 0 ? `Resend email in ${countdown}s` : "Resend email"}
      </Button>
    </AuthShell>
  );
}
