import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../contexts/AuthContext";
import { useResendVerification } from "./useResendVerification";

const POLL_INTERVAL_MS = 10_000;

/** Signed in but not yet verified: waits for the link in the inbox to be used. */
export default function VerifyPending() {
  const { refreshUser, signOut, user } = useAuth();
  const navigate = useNavigate();
  const { countdown, resend, sending } = useResendVerification(user?.email ?? "");

  useEffect(() => {
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
