import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { SITE_URL, articleHref } from "../lib/site";

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function url(loc: string, lastmod: string, changefreq: string, priority: string): string {
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export const GET: APIRoute = async () => {
  const articles = await getCollection("articles");
  const newest = articles.reduce((acc, article) => {
    const date = article.data.updatedDate ?? article.data.pubDate;
    return date > acc ? date : acc;
  }, new Date("2026-08-26T00:00:00Z"));

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url(`${SITE_URL}/`, iso(newest), "weekly", "1.0")}
${url(`${SITE_URL}/articles/`, iso(newest), "weekly", "0.8")}
${url(`${SITE_URL}/legal-notice/`, iso(newest), "yearly", "0.3")}
${url(`${SITE_URL}/privacy/`, iso(newest), "yearly", "0.3")}
${url(`${SITE_URL}/terms/`, iso(newest), "yearly", "0.3")}
${url(`${SITE_URL}/cookies/`, iso(newest), "yearly", "0.3")}
${articles
  .map((article) =>
    url(
      `${SITE_URL}${articleHref(article.id)}`,
      iso(article.data.updatedDate ?? article.data.pubDate),
      "monthly",
      "0.7",
    ),
  )
  .join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
};
