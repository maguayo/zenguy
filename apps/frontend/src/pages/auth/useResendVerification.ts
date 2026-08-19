import { useEffect, useState } from "react";

import { resendVerification } from "../../api/auth";
import { useToast } from "../../contexts/ToastContext";
import { apiErrorMessage } from "../../lib/errors";

export function useResendVerification(email: string) {
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

  const resend = async () => {
    if (!email || countdown > 0 || sending) return;
    setSending(true);
    try {
      await resendVerification(email);
      setCountdown(60);
      toast.success("Verification email sent");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return { countdown, resend, sending };
}
