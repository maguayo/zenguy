import type { Page } from "@cloudflare/puppeteer";
import { MAX_ELEMENTS } from "../../shared/constants";
import { sanitizeUrl } from "../../shared/redact";
import type { PageElementState, PageState } from "./types";

export type { PageElementState, PageState } from "./types";

export const SERIALIZE_SCRIPT = `() => {
  const MAX_ELEMENTS = ${MAX_ELEMENTS};
  const selector = [
    "a",
    "button",
    "input",
    "select",
    "textarea",
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    "[onclick]",
    '[contenteditable="true"]'
  ].join(",");

  document.querySelectorAll("[data-zg-idx]").forEach((element) => {
    element.removeAttribute("data-zg-idx");
  });

  const candidates = Array.from(document.querySelectorAll(selector))
    .map((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const enabled = !element.hasAttribute("disabled");
      const visible =
        element.getClientRects().length > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        enabled &&
        rect.width > 0 &&
        rect.height > 0;
      const inViewport =
        visible &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
      return { element, visible, inViewport };
    })
    .filter((candidate) => candidate.visible);

  const ordered = candidates
    .filter((candidate) => candidate.inViewport)
    .concat(candidates.filter((candidate) => !candidate.inViewport))
    .slice(0, MAX_ELEMENTS);

  const elements = ordered.map((candidate, index) => {
    const element = candidate.element;
    const tag = element.tagName.toLowerCase();
    element.setAttribute("data-zg-idx", String(index));
    const rawText =
      element.innerText ||
      element.value ||
      element.getAttribute("placeholder") ||
      "";
    let href = null;
    if (tag === "a" && element.hasAttribute("href")) {
      try {
        const parsed = new URL(element.href, window.location.href);
        href = parsed.host + parsed.pathname;
      } catch {
        href = null;
      }
    }
    return {
      i: index,
      tag,
      type: tag === "input" ? element.getAttribute("type") : null,
      text: String(rawText).trim().slice(0, 60),
      aria: element.getAttribute("aria-label"),
      href,
      inViewport: candidate.inViewport
    };
  });

  return {
    url: window.location.href,
    title: document.title,
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    elements,
    textDigest: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 1500)
  };
}`;

export async function serializePage(page: Page): Promise<PageState> {
  return (await page.evaluate(`(${SERIALIZE_SCRIPT})()`)) as PageState;
}

function elementLine(element: PageElementState): string {
  const tag =
    element.type === null
      ? `<${element.tag}>`
      : `<${element.tag}:${element.type}>`;
  const metadata: string[] = [];
  if (element.aria !== null) metadata.push(`aria: ${element.aria}`);
  if (element.href !== null) metadata.push(`href: ${element.href}`);
  const suffix = metadata.length === 0 ? "" : ` (${metadata.join(", ")})`;
  return `[${element.i}] ${tag} "${element.text}"${suffix}`;
}

export function formatPageState(state: PageState): string {
  return [
    `URL: ${sanitizeUrl(state.url)}`,
    `Title: ${state.title}`,
    `Scroll: ${state.scrollY}/${state.scrollHeight} (viewport ${state.innerHeight})`,
    'Interactive elements (visible-first, [index] <tag> "text"):',
    ...state.elements.map(elementLine),
    `Page text: ${state.textDigest}`,
  ].join("\n");
}
