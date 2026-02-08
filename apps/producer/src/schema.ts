import { z } from "genkit";

export const AutoInputSchema = z.object({
  topic: z.string().min(8).max(120),
  city: z.string().min(2).max(80),
  keyword: z.string().min(8).max(160),
});

export const ArticleOutlineSchema = z.object({
  audience: z.string().min(10),
  intent: z.string().min(10),
  keyTakeaways: z.array(z.string().min(8)).min(3).max(5),
  sectionPlan: z
    .array(
      z.object({
        heading: z.string().min(8),
        objective: z.string().min(20),
      }),
    )
    .min(4)
    .max(8),
  decisionChecklist: z.array(z.string().min(12)).min(4).max(8),
  commonMistakes: z.array(z.string().min(12)).min(3).max(6),
});

export const ArticleOutputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  tags: z.array(z.string().min(1)).min(3).max(8),
  audience: z.string().min(10),
  intent: z.string().min(10),
  keyTakeaways: z.array(z.string().min(8)).min(3).max(5),
  decisionChecklist: z.array(z.string().min(12)).min(4).max(8),
  commonMistakes: z.array(z.string().min(12)).min(3).max(6),
  evidenceNotes: z.array(z.string().min(8)).min(2).max(8),
  content: z.string().min(1),
  lastmod: z.string().datetime(),
});

export type ArticleOutline = z.infer<typeof ArticleOutlineSchema>;
export type ArticleOutput = z.infer<typeof ArticleOutputSchema>;
