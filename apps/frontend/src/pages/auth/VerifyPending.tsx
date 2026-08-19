import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../contexts/AuthContext";
import { useResendVerification } from "./useResendVerification";

export default function VerifyPending() {
  const { refreshUser, signOut, user } = useAuth();
  const navigate = useNavigate();
  const { countdown, resend, sending } = useResendVerification(user?.email ?? "");

  useEffect(() => {
    let polling = false;
    const timer = window.setInterval(() => {
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
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [navigate, refreshUser]);

  if (!user) return null;

  return (
    <AuthShell
      description={
        <>
          We sent a verification link to <span className="font-medium text-zinc-700">{user.email}</span>.
        </>
      }
      footer={
        <button className="font-medium text-accent-700 hover:underline" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      }
      title="Verify your email"
    >
      <Button
        className="w-full"
        disabled={countdown > 0}
        loading={sending}
        onClick={() => void resend()}
      >
        {countdown > 0 ? `Resend email in ${countdown}s` : "Resend email"}
      </Button>
    </AuthShell>
  );
}
