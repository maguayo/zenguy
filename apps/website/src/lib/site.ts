export const SITE_URL = "https://zenguy.com";
export const APP_URL = "https://app.zenguy.com";

export const homeNavLinks = [
  { href: "#how", label: "How it works" },
  { href: "#evidence", label: "Evidence" },
  { href: "#uptime", label: "Uptime" },
  { href: "#app", label: "iOS app" },
  { href: "#pricing", label: "Pricing" },
];

export const innerNavLinks = [
  { href: "/", label: "Product" },
  { href: "/#uptime", label: "Uptime" },
  { href: "/#pricing", label: "Pricing" },
];

export const footerGroups = [
  {
    label: "Product",
    links: [
      { label: "Browser tests", href: "/#how" },
      { label: "Uptime monitors", href: "/#uptime" },
      { label: "Alerts", href: "/#alerts" },
      { label: "iOS app", href: "/#app" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    label: "Resources",
    links: [
      { label: "Articles", href: "/articles/" },
      { label: "Documentation", href: "#" },
      { label: "Changelog", href: "#" },
      { label: "Status", href: "#" },
    ],
  },
  {
    label: "Company",
    links: [
      { label: "Legal notice", href: "/legal-notice/" },
      { label: "Privacy", href: "/privacy/" },
      { label: "Terms", href: "/terms/" },
      { label: "Cookies", href: "/cookies/" },
      { label: "Contact", href: "mailto:privacy@zenguy.com" },
    ],
  },
];

export const articleCategories = {
  comparison: "Comparison",
  roundup: "Roundup",
  guide: "Guide",
} as const;

export type ArticleCategory = keyof typeof articleCategories;

export function articleHref(id: string): string {
  return `/articles/${id}/`;
}

export function formatArticleDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(date);
}

export function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
