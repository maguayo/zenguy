import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { RemoteAiConsentStatus } from "../../api/types";
import {
  RemoteAiConsentCardView,
  type RemoteAiConsentCardViewProps,
  consentStatusLabel,
} from "./RemoteAiConsentCard";

const off: RemoteAiConsentStatus = {
  acceptedAt: null,
  active: false,
  policyVersion: "2026-09-01-v1",
  provider: "OpenAI",
  revokedAt: null,
};

const noop = () => undefined;

function render(overrides: Partial<RemoteAiConsentCardViewProps> = {}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RemoteAiConsentCardView
        affirmed={false}
        busy={false}
        error={false}
        loading={false}
        status={off}
        timezone="Europe/Madrid"
        onAffirmedChange={noop}
        onEnable={noop}
        onRetry={noop}
        onRevoke={noop}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

const enableButton = /<button[^>]*>(?:(?!<\/button>).)*Enable OpenAI processing/s;

describe("remote AI consent card", () => {
  it("tells the truth about the runner and starts off, unchecked and disabled", () => {
    const html = render();
    expect(html).toContain('id="ai-data-sharing"');
    expect(html).toContain("Cloudflare Containers");
    expect(html).not.toContain("fallback");
    expect(html).not.toContain("local runner");
    expect(html).toContain(">Off<");
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).not.toMatch(/<input[^>]*\schecked/);
    expect(html.match(enableButton)?.[0]).toContain('disabled=""');
    expect(html).toContain('href="/privacy"');
  });

  it("only arms the enable button after the affirmative box is ticked", () => {
    const html = render({ affirmed: true });
    expect(html).toMatch(/<input[^>]*\schecked/);
    expect(html.match(enableButton)?.[0]).not.toContain('disabled=""');
  });

  it("shows the acceptance record and a revoke action while enabled", () => {
    const html = render({
      status: { ...off, acceptedAt: "2026-09-02T06:17:13.000Z", active: true },
    });
    expect(html).toContain(">Enabled<");
    expect(html).toContain("policy 2026-09-01-v1");
    expect(html).toContain("Revoke consent");
    expect(html).not.toContain("Enable OpenAI processing");
  });

  it("labels the status for the badge", () => {
    expect(consentStatusLabel(undefined)).toBe("Off");
    expect(consentStatusLabel({ active: true })).toBe("Enabled");
  });
});
