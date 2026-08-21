import { Stack } from "expo-router";

import { stackScreenOptions } from "@/lib/stack-options";

export const unstable_settings = { initialRouteName: "uptime/index" };

export default function UptimeStackLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}
