import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

import { colors, fonts } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

function TabIcon({
  active,
  color,
  focused,
  inactive,
  size,
}: {
  active: IconName;
  color: ColorValue;
  focused: boolean;
  inactive: IconName;
  size: number;
}) {
  return <Ionicons color={color} name={focused ? active : inactive} size={size} />;
}

export default function WorkspaceTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.sans.medium, fontSize: 11 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="(overview)"
        options={{
          tabBarButtonTestID: "tab-overview",
          tabBarIcon: (props) => <TabIcon {...props} active="grid" inactive="grid-outline" />,
          title: "Overview",
        }}
      />
      <Tabs.Screen
        name="(tests)"
        options={{
          tabBarButtonTestID: "tab-tests",
          tabBarIcon: (props) => <TabIcon {...props} active="globe" inactive="globe-outline" />,
          title: "Tests",
        }}
      />
      <Tabs.Screen
        name="(uptime)"
        options={{
          tabBarButtonTestID: "tab-uptime",
          tabBarIcon: (props) => <TabIcon {...props} active="pulse" inactive="pulse-outline" />,
          title: "Uptime",
        }}
      />
      <Tabs.Screen
        name="(incidents)"
        options={{
          tabBarButtonTestID: "tab-incidents",
          tabBarIcon: (props) => (
            <TabIcon {...props} active="alert-circle" inactive="alert-circle-outline" />
          ),
          title: "Incidents",
        }}
      />
      <Tabs.Screen
        name="(more)"
        options={{
          tabBarButtonTestID: "tab-more",
          tabBarIcon: (props) => (
            <TabIcon
              {...props}
              active="ellipsis-horizontal-circle"
              inactive="ellipsis-horizontal-circle-outline"
            />
          ),
          title: "More",
        }}
      />
    </Tabs>
  );
}
