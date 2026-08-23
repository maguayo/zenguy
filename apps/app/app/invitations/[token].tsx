import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useLayoutEffect } from "react";

import { AuthStatus } from "@/components/auth/AuthStatus";
import { captureLinkCapability } from "@/lib/link-capabilities";
import { Spinner } from "@/ui";

/**
 * Universal Links initially need the token-shaped route to receive the
 * capability. Move it to bounded process memory, clear Expo's cached launch
 * URL and replace the navigation entry before any API request is made.
 */
export default function InvitationLinkBridge() {
  const params = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();

  useLayoutEffect(() => {
    captureLinkCapability("invitation", params.token);
    Linking.clearInitialURL();
    router.replace("/invitations/accept");
  }, [params.token, router]);

  return (
    <AuthStatus icon="users" title="Opening invitation">
      <Spinner label="Opening invitation" size="large" />
    </AuthStatus>
  );
}
