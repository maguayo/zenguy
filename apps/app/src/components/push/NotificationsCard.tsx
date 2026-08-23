import { StyleSheet, View } from "react-native";

import { usePush } from "@/contexts/PushContext";
import { useToast } from "@/contexts/ToastContext";
import { apiErrorMessage } from "@/lib/errors";
import { pushDeniedMessage, unavailableMessage } from "@/lib/push";
import { spacing } from "@/theme";
import { Button, Caption, Card, Muted, Toggle } from "@/ui";

/** Account → Notifications: permission state and the per-device switch. */
export function NotificationsCard() {
  const push = usePush();
  const toast = useToast();

  const toggle = async (enabled: boolean) => {
    try {
      await push.setDeviceEnabled(enabled);
      toast.success(enabled ? "Alerts enabled on this iPhone" : "Alerts paused on this iPhone");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  let content;
  if (push.permission === "unavailable") {
    content = <Muted>{unavailableMessage(push.reason)}</Muted>;
  } else if (push.permission === "denied") {
    content = (
      <View style={styles.stack}>
        <Muted>{pushDeniedMessage}</Muted>
        <Button title="Open Settings" onPress={push.openSettings} />
      </View>
    );
  } else if (push.permission === "undetermined") {
    content = (
      <View style={styles.stack}>
        <Muted>Get notified on this iPhone when a test fails or a site goes down.</Muted>
        <Button
          title="Enable notifications"
          variant="accent"
          onPress={() => void push.requestPermission()}
        />
      </View>
    );
  } else if (push.device) {
    content = (
      <View style={styles.stack}>
        <Toggle
          description={`${push.device.deviceName ?? "This iPhone"} · token …${push.device.tokenSuffix}`}
          label="Notifications on this iPhone"
          value={push.device.enabled}
          onValueChange={(value) => void toggle(value)}
        />
      </View>
    );
  } else {
    content = (
      <View style={styles.stack}>
        <Muted>{push.registering ? "Registering this iPhone…" : push.registerError ?? "This iPhone isn't registered yet."}</Muted>
        {!push.registering ? <Button title="Try again" onPress={() => void push.retryRegistration()} /> : null}
      </View>
    );
  }

  return (
    <Card title="Notifications">
      {content}
      <Caption style={styles.note}>
        Push alerts are free and go to every workspace member with the Zenguy app.
      </Caption>
    </Card>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: spacing.lg },
  stack: { gap: spacing.md },
});
