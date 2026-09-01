import { after } from "next/server"
import { ok, parseBody, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { decisionSchema } from "@/lib/schemas/review"
import { sanitize, sanitizeOptional } from "@/lib/sanitize"
import { finalizeReview } from "@/lib/review"
import { ReviewResult } from "@/app/generated/prisma/enums"
import { syncThemeProjectToYsws } from "@/lib/airtable/sync"
import { trackSideEffect } from "@/lib/side-effects"

type Params = { params: Promise<{ id: string }> }

export const maxDuration = 60

export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.REVIEW_SUBMISSIONS)
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, decisionSchema)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const outcome = await finalizeReview({
    submissionId: id,
    reviewerId: gate.user.id,
    reviewerName: gate.user.name,
    reviewerEmail: gate.user.email,
    result: body.result,
    feedback: sanitize(body.feedback ?? ""),
    reason: "reason" in body ? sanitizeOptional(body.reason) : null,
    tier: "tier" in body ? (body.tier ?? null) : null,
    hoursOverride: "hoursOverride" in body ? (body.hoursOverride ?? null) : null,
    grantUsdOverride: "grantUsdOverride" in body ? (body.grantUsdOverride ?? null) : null,
  })

  // The grant row is written after the response, so a slow Airtable does not
  // hold the reviewer's request open. Failures land in the audit log and are
  // replayable from /admin/theme-projects/unsynced.
  if (body.result === ReviewResult.APPROVED) {
    const reviewerName = gate.user.name
    const reviewerNote = "reason" in body ? (body.reason ?? null) : null
    after(async () => {
      await trackSideEffect(
        "airtable",
        {
          actorId: gate.user.id,
          actorEmail: gate.user.email,
          targetType: "ThemeProject",
          targetId: outcome.themeProjectId,
          metadata: { phase: outcome.phase },
        },
        () =>
          syncThemeProjectToYsws(outcome.themeProjectId, outcome.phase, {
            reviewerName,
            reviewerNote,
          }),
      )
    })
  }

  return ok({ outcome })
})
