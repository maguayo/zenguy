import type { Stack } from "expo-router";
import type { ComponentProps } from "react";

import { colors, fonts } from "@/theme";

type StackScreenOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack>["screenOptions"]>,
  (...args: never[]) => unknown
>;

/** Shared native-stack header styling: paper canvas, ink titles set in Geist. */
export const stackScreenOptions: StackScreenOptions = {
  contentStyle: { backgroundColor: colors.bg },
  headerBackButtonDisplayMode: "minimal",
  headerLargeTitleShadowVisible: false,
  headerShadowVisible: false,
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.ink,
  headerTitleStyle: { color: colors.text, fontFamily: fonts.sans.semibold, fontSize: 17 },
};

export const largeTitleOptions: StackScreenOptions = {
  headerLargeTitle: true,
  headerLargeTitleStyle: { color: colors.text, fontFamily: fonts.sans.bold, fontSize: 34 },
  headerTransparent: false,
};
