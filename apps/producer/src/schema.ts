import { z } from "genkit";

export const ArticleOutputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  tags: z.array(z.string().min(1)).min(1),
  content: z.string().min(1),
  lastmod: z.string().datetime(),
});

export type ArticleOutput = z.infer<typeof ArticleOutputSchema>;
