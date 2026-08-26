import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { SITE_URL, articleHref } from "../../lib/site";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const GET: APIRoute = async () => {
  const articles = (await getCollection("articles")).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );

  const items = articles
    .map((article) => {
      const link = `${SITE_URL}${articleHref(article.id)}`;
      return `    <item>
      <title>${escapeXml(article.data.title)}</title>
      <link>${link}</link>
      <guid>${link}</guid>
      <pubDate>${article.data.pubDate.toUTCString()}</pubDate>
      <description>${escapeXml(article.data.description)}</description>
    </item>`;
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Zenguy articles</title>
    <link>${SITE_URL}/articles/</link>
    <description>Guides and comparisons on production browser tests and uptime monitoring, written by Zenguy.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
};
