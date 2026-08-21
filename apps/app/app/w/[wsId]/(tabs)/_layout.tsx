import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

import { colors } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

function icon(active: IconName, inactive: IconName) {
  return ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons color={color} name={focused ? active : inactive} size={size} />
  );
}

export default function WorkspaceTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.zinc500,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="(overview)" options={{ tabBarIcon: icon("grid", "grid-outline"), title: "Overview" }} />
      <Tabs.Screen name="(tests)" options={{ tabBarIcon: icon("globe", "globe-outline"), title: "Tests" }} />
      <Tabs.Screen name="(uptime)" options={{ tabBarIcon: icon("pulse", "pulse-outline"), title: "Uptime" }} />
      <Tabs.Screen name="(incidents)" options={{ tabBarIcon: icon("alert-circle", "alert-circle-outline"), title: "Incidents" }} />
      <Tabs.Screen name="(more)" options={{ tabBarIcon: icon("ellipsis-horizontal-circle", "ellipsis-horizontal-circle-outline"), title: "More" }} />
    </Tabs>
  );
}
