const preset = require("jest-expo/jest-preset");

// jest-expo already transforms the React Native / Expo ecosystem; a few extra
// ESM-only dependencies of expo-router need the same treatment.
const extraTransformed = ["standard-navigation", "@tanstack/.*"];
const transformIgnorePatterns = preset.transformIgnorePatterns.map((pattern) =>
  pattern.replace("node_modules/(?!(", `node_modules/(?!(${extraTransformed.join("|")}|`),
);

module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
  transformIgnorePatterns,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
