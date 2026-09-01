import { z } from "zod"
import { HoursSource, MediaType } from "@/app/generated/prisma/enums"
import { boundedText, httpsUrl, phaseSchema } from "@/lib/schemas/common"

const mediaSchema = z.object({
  type: z.enum(MediaType),
  objectKey: z.string().min(1).max(500),
  contentType: z.string().max(120).optional(),
  byteSize: z.number().int().positive().optional(),
})

const timelapseSchema = z.object({
  objectKey: z.string().max(500).optional(),
  playbackUrl: httpsUrl.optional(),
  /** Wall-clock seconds the timelapse represents, not the video's runtime. */
  coveredSeconds: z.number().int().min(0).max(86_400).optional(),
  runtimeSeconds: z.number().int().min(0).max(86_400).optional(),
  speedupFactor: z.number().positive().max(10_000).optional(),
})

export const sessionCreateSchema = z
  .object({
    phase: phaseSchema,
    title: boundedText(200, 1),
    content: boundedText(20_000).optional(),
    // A single sitting cannot exceed a day. This is a sanity bound, not a policy.
    hoursClaimed: z.number().min(0).max(24),
    /**
     * MANUAL counts toward the journal total; HACKATIME_TRACKED does not,
     * because those hours already arrive through the linked project.
     */
    hoursSource: z.enum(HoursSource).default("MANUAL"),
    media: z.array(mediaSchema).max(10).default([]),
    timelapses: z.array(timelapseSchema).max(5).default([]),
  })
  .strict()

export const sessionUpdateSchema = sessionCreateSchema.partial().strict()

export type SessionCreateInput = z.infer<typeof sessionCreateSchema>
