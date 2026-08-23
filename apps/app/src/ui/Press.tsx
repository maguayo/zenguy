import { useState, type ReactNode } from "react";
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

interface Props extends Omit<PressableProps, "style"> {
  children: ReactNode;
  /** Scale applied while pressed (default 0.985). */
  scaleTo?: number;
  /** Layout style for the pressable itself (flex, margins); the content scales inside it. */
  style?: StyleProp<ViewStyle>;
}

/** Pressable with a soft spring scale, for cards and tiles. */
export function Press({ children, onPressIn, onPressOut, scaleTo = 0.985, style, ...props }: Props) {
  const [scale] = useState(() => new Animated.Value(1));
  const animate = (toValue: number) =>
    Animated.spring(scale, { friction: 7, tension: 120, toValue, useNativeDriver: true }).start();
  return (
    <Pressable
      {...props}
      style={style}
      onPressIn={(event) => {
        animate(scaleTo);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1);
        onPressOut?.(event);
      }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}
