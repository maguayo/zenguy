import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useLayoutEffect } from "react";

import { AuthStatus } from "@/components/auth/AuthStatus";
import { captureLinkCapability } from "@/lib/link-capabilities";
import { Spinner } from "@/ui";

export default function GrantLinkBridge() {
  const params = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();

  useLayoutEffect(() => {
    captureLinkCapability("grant", params.token);
    Linking.clearInitialURL();
    router.replace("/grants/redeem");
  }, [params.token, router]);

  return (
    <AuthStatus icon="gift" title="Opening complimentary link">
      <Spinner label="Opening complimentary link" size="large" />
    </AuthStatus>
  );
}
