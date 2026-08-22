import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/theme";

/** Public screens: a signed-in user is always sent back into the app. */
export default function AuthLayout() {
  const { status } = useAuth();
  if (status === "signedIn") return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.bg },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerShown: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.accent,
        title: "",
      }}
    >
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" options={{ headerShown: true }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: true }} />
      <Stack.Screen name="reset-password" options={{ headerShown: true }} />
    </Stack>
  );
}
