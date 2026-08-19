import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { resendVerification } from "../../api/auth";
import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { apiErrorMessage } from "../../lib/errors";

export default function VerifyPending() {
  const { refreshUser, signOut, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setInterval(
      () => setCountdown((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [countdown]);

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

  const resend = async () => {
    setSending(true);
    try {
      await resendVerification(user.email);
      setCountdown(60);
      toast.success("Verification email sent");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSending(false);
    }
  };

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
