import { forwardRef, useState } from "react";
import type { TextInput } from "react-native";

import { Input, type InputProps } from "@/ui";

import { parseNumberInput } from "./monitor-form";

interface Props extends Omit<InputProps, "onChange" | "onChangeText" | "value"> {
  onChange: (value: number) => void;
  value: number;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function sameNumber(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

/**
 * A numeric field for react-hook-form: the form holds a number (NaN while the
 * entry is empty or invalid, like the web's `valueAsNumber`) while the input
 * keeps the text the user typed, so "20" never snaps to "200" mid-edit.
 */
export const NumberInput = forwardRef<TextInput, Props>(function NumberInput(
  { onChange, value, ...props },
  ref,
) {
  const [text, setText] = useState(() => formatNumber(value));
  const [tracked, setTracked] = useState(value);
  if (!sameNumber(tracked, value)) {
    // The form changed the value from outside (reset, API details): resync.
    setTracked(value);
    if (!sameNumber(parseNumberInput(text), value)) setText(formatNumber(value));
  }
  return (
    <Input
      ref={ref}
      inputMode="numeric"
      keyboardType="number-pad"
      {...props}
      value={text}
      onChangeText={(next) => {
        setText(next);
        const parsed = parseNumberInput(next);
        setTracked(parsed);
        onChange(parsed);
      }}
    />
  );
});
