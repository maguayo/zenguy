import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ActivityTracker } from "@/components/ActivityTracker";
import { AppLockBoundary } from "@/components/AppLockBoundary";
import { PrivacyShield } from "@/components/PrivacyShield";
import { UpdateGate } from "@/components/UpdateGate";
import { AppLockProvider } from "@/contexts/AppLockContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PushProvider } from "@/contexts/PushContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { queryClient } from "@/lib/query-client";
import { cleanupSharedFiles } from "@/lib/share";
import { colors, fonts } from "@/theme";
import { Button, ErrorState, Screen } from "@/ui";

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { retry, status } = useAuth();

  useEffect(() => {
    if (status !== "loading") void SplashScreen.hideAsync();
  }, [status]);

  if (status === "unavailable") {
    return (
      <Screen safe={["top", "bottom"]} scroll={false}>
        <View style={styles.offline}>
          <ErrorState
            message="Zenguy can't be reached right now. Check your connection and try again."
            retryLabel="Try again"
            onRetry={retry}
          />
          <SignOutOffline />
        </View>
      </Screen>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerShown: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerTitleStyle: { color: colors.text, fontFamily: fonts.sans.semibold, fontSize: 17 },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="w/[wsId]" />
      <Stack.Screen name="access-unavailable" />
      <Stack.Screen name="invitations/[token]" options={{ headerShown: true, title: "Invitation" }} />
      <Stack.Screen name="invitations/accept" options={{ headerShown: true, title: "Invitation" }} />
      <Stack.Screen name="privacy" options={{ headerShown: true, presentation: "modal", title: "Privacy" }} />
      <Stack.Screen name="terms" options={{ headerShown: true, presentation: "modal", title: "Terms" }} />
    </Stack>
  );
}

function SignOutOffline() {
  const { signOut } = useAuth();
  return (
    <Button
      style={styles.signOut}
      title="Sign out on this device"
      variant="ghost"
      onPress={() => void signOut()}
    />
  );
}

function ProtectedAppContent() {
  return (
    <>
      <AppLockBoundary>
        <StatusBar style="dark" />
        <RootNavigator />
        <UpdateGate />
        <ActivityTracker />
      </AppLockBoundary>
      <PrivacyShield />
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void cleanupSharedFiles();
  }, []);

  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AuthProvider>
              <PushProvider>
                <AppLockProvider>
                  <ProtectedAppContent />
                </AppLockProvider>
              </PushProvider>
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  offline: { alignItems: "center", flex: 1, justifyContent: "center" },
  signOut: { alignSelf: "center", marginTop: 8 },
});
