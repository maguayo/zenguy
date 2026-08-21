import { Redirect, Stack, usePathname } from "expo-router";

import { useAuth } from "@/contexts/AuthContext";
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import { colors } from "@/theme";

function WorkspaceStack() {
  const { current } = useWorkspace();
  // Keyed by workspace so switching workspaces resets every nested navigator.
  return (
    <Stack
      key={current.id}
      screenOptions={{ contentStyle: { backgroundColor: colors.bg }, headerShown: false }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="setup/billing" />
    </Stack>
  );
}

/** Everything under /w/[wsId] needs a verified, signed-in user and a workspace. */
export default function WorkspaceLayout() {
  const { status, user } = useAuth();
  const pathname = usePathname();

  if (status === "signedOut") {
    return <Redirect href={{ params: { next: pathname }, pathname: "/(auth)/sign-in" }} />;
  }
  if (user && !user.emailVerified) return <Redirect href="/verify-pending" />;

  return (
    <WorkspaceProvider>
      <WorkspaceStack />
    </WorkspaceProvider>
  );
}
