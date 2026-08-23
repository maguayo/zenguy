import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";

let reducedMotionCache: boolean | null = null;

/** Honour "Reduce Motion"; resolves asynchronously, defaults to animating. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reducedMotionCache ?? false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      reducedMotionCache = value;
      if (active) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      reducedMotionCache = value;
      setReduced(value);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

/**
 * A slow breathing opacity (1 → 0.35 → 1) while `active`; the pulse used by
 * in-progress dots and the newest tick of a strip.
 */
export function useBreathing(active: boolean, period = 1400): Animated.Value {
  const [value] = useState(() => new Animated.Value(1));
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!active || reduced) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          duration: period / 2,
          easing: Easing.inOut(Easing.quad),
          toValue: 0.35,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          duration: period / 2,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, period, reduced, value]);
  return value;
}

/** Fade + rise used once per screen for the hero. */
export function useReveal(enabled = true): { opacity: Animated.Value; translateY: Animated.Value } {
  const [opacity] = useState(() => new Animated.Value(enabled ? 0 : 1));
  const [translateY] = useState(() => new Animated.Value(enabled ? 12 : 0));
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!enabled) return;
    if (reduced) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { duration: 420, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }),
      Animated.timing(translateY, { duration: 520, easing: Easing.out(Easing.cubic), toValue: 0, useNativeDriver: true }),
    ]).start();
  }, [enabled, opacity, reduced, translateY]);
  return { opacity, translateY };
}
