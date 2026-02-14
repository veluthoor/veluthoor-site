import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    slug: z.string().optional(),
    date: z.string().optional(),
    status: z.string().optional(),
    excerpt: z.string().optional(),
    feature_image: z.string().optional(),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    slug: z.string().optional(),
    date: z.string().optional(),
    status: z.string().optional(),
    excerpt: z.string().optional(),
    feature_image: z.string().optional(),
  }),
});

export const collections = { blog, pages };
