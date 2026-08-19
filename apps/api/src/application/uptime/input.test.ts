import { parseMonitorTestRequest, parseMonitorUpdate } from "./input";

const CONFIG = {
  url: "https://example.com/health",
  method: "GET",
  expectedStatus: 200,
  frequencySeconds: 300,
  timeoutSeconds: 10,
  maxRetries: 0,
  notifyOnRecovery: true,
  channelIds: [],
};

describe("uptime monitor input parsing", () => {
  it("keeps PATCH input partial without injecting create defaults", () => {
    expect(parseMonitorUpdate({ frequencySeconds: 600 })).toEqual({
      frequencySeconds: 600,
    });
  });

  it("allows test-request to omit only the monitor name", () => {
    expect(parseMonitorTestRequest(CONFIG)).toMatchObject({
      ...CONFIG,
      name: "Test request",
    });
  });
});
