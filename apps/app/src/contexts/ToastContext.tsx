import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/theme";
import { Small } from "@/ui";

type ToastTone = "error" | "info" | "success";

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastApi {
  error: (message: string) => void;
  info: (message: string) => void;
  success: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function appendToast(items: ToastItem[], item: ToastItem): ToastItem[] {
  return [...items, item].slice(-3);
}

const toneIcon: Record<ToastTone, { color: string; name: "alert-circle" | "check-circle" | "info" }> = {
  error: { color: colors.danger, name: "alert-circle" },
  info: { color: colors.info, name: "info" },
  success: { color: colors.ok, name: "check-circle" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const insets = useSafeAreaInsets();

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const add = useCallback(
    (message: string, tone: ToastTone) => {
      const id = ++nextId.current;
      setItems((current) => appendToast(current, { id, message, tone }));
      const duration = tone === "error" ? 6_000 : 3_500;
      timers.current.set(id, setTimeout(() => remove(id), duration));
    },
    [remove],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      error: (message) => add(message, "error"),
      info: (message) => add(message, "info"),
      success: (message) => add(message, "success"),
    }),
    [add],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <View pointerEvents="box-none" style={[styles.stack, { top: insets.top + spacing.sm }]}>
        {items.map((item) => {
          const icon = toneIcon[item.tone];
          return (
            <Pressable
              key={item.id}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={styles.toast}
              onPress={() => remove(item.id)}
            >
              <Feather color={icon.color} name={icon.name} size={18} />
              <Small style={styles.message}>{item.message}</Small>
            </Pressable>
          );
        })}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within ToastProvider");
  return value;
}

const styles = StyleSheet.create({
  message: { flex: 1 },
  stack: { gap: spacing.sm, left: spacing.lg, position: "absolute", right: spacing.lg, zIndex: 900 },
  toast: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    shadowColor: colors.zinc950,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
});
