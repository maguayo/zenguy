import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { Button } from "./Button";

describe("Button", () => {
  it("calls onPress when enabled", async () => {
    const onPress = jest.fn();
    await render(<Button title="Save" onPress={onPress} />);
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("ignores presses while loading or disabled", async () => {
    const onPress = jest.fn();
    await render(<Button loading title="Save" onPress={onPress} />);
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" }).props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
  });
});
