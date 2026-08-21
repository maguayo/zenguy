import type { Stack } from "expo-router";
import type { ComponentProps } from "react";

import { colors } from "@/theme";

type StackScreenOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack>["screenOptions"]>,
  (...args: never[]) => unknown
>;

/** Shared native-stack header styling for every tab stack. */
export const stackScreenOptions: StackScreenOptions = {
  contentStyle: { backgroundColor: colors.bg },
  headerBackButtonDisplayMode: "minimal",
  headerLargeTitleShadowVisible: false,
  headerShadowVisible: false,
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.accent,
  headerTitleStyle: { color: colors.text },
};

export const largeTitleOptions: StackScreenOptions = {
  headerLargeTitle: true,
  headerLargeTitleStyle: { color: colors.text },
  headerTransparent: false,
};
