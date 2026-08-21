import { Alert } from "react-native";

export interface ConfirmOptions {
  cancelLabel?: string;
  confirmLabel?: string;
  destructive?: boolean;
  message?: string;
  title: string;
}

/** Native confirmation dialog; resolves true when the user confirms. */
export function confirm({
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  destructive = false,
  message,
  title,
}: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { onPress: () => resolve(false), style: "cancel", text: cancelLabel },
        {
          onPress: () => resolve(true),
          style: destructive ? "destructive" : "default",
          text: confirmLabel,
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
