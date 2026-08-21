import { Stack } from "expo-router";

import { stackScreenOptions } from "@/lib/stack-options";

export const unstable_settings = { initialRouteName: "overview" };

export default function OverviewStackLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}
