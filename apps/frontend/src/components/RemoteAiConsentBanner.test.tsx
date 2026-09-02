import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { RemoteAiConsentStatus } from "../api/types";
import {
  RemoteAiConsentBannerView,
  shouldShowRemoteAiConsentBanner,
} from "./RemoteAiConsentBanner";

const off: RemoteAiConsentStatus = {
  acceptedAt: null,
  active: false,
  policyVersion: "2026-09-01-v1",
  provider: "OpenAI",
  revokedAt: null,
};

describe("remote AI consent banner", () => {
  it("appears only for roles that can grant consent while it is off", () => {
    expect(shouldShowRemoteAiConsentBanner({ canManage: true, status: off })).toBe(true);
    expect(
      shouldShowRemoteAiConsentBanner({ canManage: true, status: { ...off, active: true } }),
    ).toBe(false);
    expect(shouldShowRemoteAiConsentBanner({ canManage: false, status: off })).toBe(false);
    expect(shouldShowRemoteAiConsentBanner({ canManage: true, status: undefined })).toBe(false);
  });

  it("explains that runs will not start and links to the settings card", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RemoteAiConsentBannerView wsId="ws_1" />
      </MemoryRouter>,
    );
    expect(html).toContain("Browser tests won");
    expect(html).toContain("Cloudflare Containers");
    expect(html).toContain('href="/w/ws_1/settings#ai-data-sharing"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain("fallback");
  });
});
