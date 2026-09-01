import { z } from "zod"
import { boundedText, httpsUrl, phaseSchema } from "@/lib/schemas/common"

export const projectUpdateSchema = z
  .object({
    title: boundedText(120, 1).optional(),
    description: boundedText(4000).optional(),
    githubRepo: httpsUrl.nullable().optional(),
    coverImageKey: z.string().max(500).nullable().optional(),
    artifactLinks: z.array(z.object({ label: boundedText(80, 1), url: httpsUrl })).max(10).optional(),
  })
  .strict()

export const submitSchema = z
  .object({
    phase: phaseSchema,
    notes: boundedText(4000).optional(),
  })
  .strict()

export const unsubmitSchema = z.object({ phase: phaseSchema }).strict()

export const hackatimeLinkSchema = z
  .object({
    hackatimeProject: boundedText(200, 1),
    phase: phaseSchema.default("BUILD"),
  })
  .strict()

export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>
