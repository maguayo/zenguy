import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import {
  applyCookieConsentChoice,
  CookieConsentBanner,
} from "./CookieConsent";

describe("cookie consent banner", () => {
  it("offers accept and reject together with equal button treatment", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CookieConsentBanner
          onAccept={() => undefined}
          onOpenPreferences={() => undefined}
          onReject={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(html).toContain('aria-label="Cookie choices"');
    expect(html).toContain("Reject analytics");
    expect(html).toContain("Accept analytics");
    expect(html).toContain("Manage preferences");
    expect(html.match(/border-zinc-300 bg-white text-zinc-800/g)).toHaveLength(2);
  });

  it("persists and clears analytics before reloading after revocation", () => {
    const calls: string[] = [];
    const reload = vi.fn(() => calls.push("reload"));
    const record = applyCookieConsentChoice(false, {
      initialize: vi.fn(() => false),
      isPersisted: () => true,
      reload,
      revoke: vi.fn(() => {
        calls.push("revoke");
        return true;
      }),
      write: (analytics) => {
        calls.push(`write:${analytics}`);
        return {
          analytics,
          updatedAt: "2026-08-30T12:00:00.000Z",
          version: 2,
        };
      },
    });

    expect(record.analytics).toBe(false);
    expect(calls).toEqual(["write:false", "revoke", "reload"]);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload into stale granted consent when persistence fails", () => {
    const reload = vi.fn();
    const revoke = vi.fn(() => true);
    applyCookieConsentChoice(false, {
      initialize: vi.fn(() => false),
      isPersisted: () => false,
      reload,
      revoke,
      write: (analytics) => ({
        analytics,
        updatedAt: "2026-08-30T12:00:00.000Z",
        version: 2,
      }),
    });
    expect(revoke).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
});
