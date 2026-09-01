import { buildApp } from "../../app";
import { loadConfig } from "../../shared/config";
import { MIN_APP_VERSION } from "../../shared/constants";
import { testEnv } from "../../test/helpers";

describe("app version requirements", () => {
  it("publishes the minimum app version without authentication", async () => {
    const app = buildApp(testEnv());
    const response = await app.request("/api/app/version");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    await expect(response.json()).resolves.toEqual({
      data: { minVersion: MIN_APP_VERSION, storeUrl: null },
    });
    expect(MIN_APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("includes the App Store link when the environment provides one", async () => {
    const app = buildApp({
      ...testEnv(),
      IOS_APP_STORE_URL: "https://apps.apple.com/app/id6804201911",
    });
    const response = await app.request("/api/app/version");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        minVersion: MIN_APP_VERSION,
        storeUrl: "https://apps.apple.com/app/id6804201911",
      },
    });
  });

  it("refuses a store link that is not an https App Store URL", () => {
    expect(() =>
      loadConfig({ ...testEnv(), IOS_APP_STORE_URL: "http://apps.apple.com/app/id1" }),
    ).toThrow(/IOS_APP_STORE_URL/u);
    expect(() =>
      loadConfig({ ...testEnv(), IOS_APP_STORE_URL: "https://example.com/not-the-store" }),
    ).toThrow(/IOS_APP_STORE_URL/u);
    expect(() =>
      loadConfig({
        ...testEnv(),
        IOS_APP_STORE_URL: "https://apps.apple.com/app/id123456789",
      }),
    ).toThrow(/6804201911/u);
    expect(() =>
      loadConfig({
        ...testEnv(),
        IOS_APP_STORE_URL: "https://apps.apple.com/es/app/zenguy/id6804201911?mt=8",
      }),
    ).toThrow(/canonical/u);
    expect(loadConfig({ ...testEnv(), IOS_APP_STORE_URL: "  " }).iosAppStoreUrl).toBeNull();
  });
});
