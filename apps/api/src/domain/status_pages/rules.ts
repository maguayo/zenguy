import { z } from "zod";
import { conflict } from "../../shared/errors";
import type { CustomDomainStatus } from "./types";

/** Slugs the public /status/* namespace keeps for itself. */
export const RESERVED_STATUS_PAGE_SLUGS = new Set([
  "json",
  "preview",
  "assets",
  "api",
  "app",
  "admin",
  "www",
  "status",
  "zenguy",
  "docs",
  "help",
  "staging",
]);

export const statusPageSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/u,
    "Lowercase letters, digits and hyphens (3-63 chars)",
  )
  .refine((slug) => !RESERVED_STATUS_PAGE_SLUGS.has(slug), {
    message: "This slug is reserved",
  });

const accentColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/u, "Hex color like #22c55e");
const themeSchema = z.enum(["LIGHT", "DARK", "SYSTEM"]);

export const statusPageConfigSchema = z.object({
  title: z.string().trim().min(1).max(120),
  slug: statusPageSlugSchema,
  description: z.string().trim().max(500).nullish(),
  accentColor: accentColorSchema.nullish(),
  theme: themeSchema.default("SYSTEM"),
});
export type StatusPageConfig = z.infer<typeof statusPageConfigSchema>;

export const statusPageUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  slug: statusPageSlugSchema.optional(),
  description: z.string().trim().max(500).nullish(),
  accentColor: accentColorSchema.nullish(),
  theme: themeSchema.optional(),
});
export type StatusPageConfigUpdate = z.infer<typeof statusPageUpdateSchema>;

export const statusPageItemConfigSchema = z.object({
  resourceType: z.enum(["BROWSER_TEST", "UPTIME_MONITOR"]),
  resourceId: z.string().min(1).max(80),
  displayName: z.string().trim().min(1).max(80),
  groupName: z.string().trim().min(1).max(60).nullish(),
});
export type StatusPageItemConfig = z.infer<typeof statusPageItemConfigSchema>;

export const statusPageItemUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  groupName: z.string().trim().min(1).max(60).nullish(),
});
export type StatusPageItemConfigUpdate = z.infer<
  typeof statusPageItemUpdateSchema
>;

const HOSTNAME_PATTERN =
  /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

export const customDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => HOSTNAME_PATTERN.test(value), {
    message: "Enter a hostname like status.example.com",
  })
  .refine(
    (value) => value !== "zenguy.com" && !value.endsWith(".zenguy.com"),
    { message: "zenguy.com hostnames cannot be used as custom domains" },
  );

/** Maps a Cloudflare custom hostname record onto our persisted status. */
export function customDomainStatusFromHostname(
  status: string,
  sslStatus: string | null,
): CustomDomainStatus {
  if (status === "active" && sslStatus === "active") return "ACTIVE";
  if (["blocked", "deleted", "moved", "test_failed"].includes(status)) {
    return "FAILED";
  }
  return "PENDING";
}

export function throwIfDomainTaken(error: unknown): void {
  if (
    error instanceof Error &&
    /UNIQUE/iu.test(error.message) &&
    /custom_domain/iu.test(error.message)
  ) {
    throw conflict("This domain is already connected to another status page");
  }
}

export function throwIfSlugTaken(error: unknown): void {
  if (
    error instanceof Error &&
    /UNIQUE/iu.test(error.message) &&
    /status_pages/iu.test(error.message)
  ) {
    throw conflict("Slug already in use");
  }
}

export function throwIfDuplicateItem(error: unknown): void {
  if (
    error instanceof Error &&
    /UNIQUE/iu.test(error.message) &&
    /status_page_items|idx_spi_page/iu.test(error.message)
  ) {
    throw conflict("Resource already on this page");
  }
}
