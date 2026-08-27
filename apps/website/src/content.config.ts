import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const articles = defineCollection({
  loader: glob({ base: "./src/content/articles", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.enum(["comparison", "roundup", "guide"]),
    tags: z.array(z.string()).default([]),
    related: z.array(z.string()).default([]),
    image: z.string(),
    imageAlt: z.string(),
  }),
});

export const collections = { articles };
