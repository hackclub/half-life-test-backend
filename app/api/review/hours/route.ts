import prisma from "@/lib/prisma"
import { ok, parseBody, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { hoursDecisionSchema } from "@/lib/schemas/review"
import { sanitizeOptional } from "@/lib/sanitize"
import { AuditAction, logAudit } from "@/lib/audit"

/**
 * Batched, because a reviewer approves a whole project's hours in one pass and
 * one request per entry would be a dozen round trips per review.
 */
export const POST = withRoute(async (req: Request) => {
  const gate = await requirePermission(Permission.REVIEW_HOURS)
  if (gate.error) return gate.error

  const parsed = await parseBody(req, hoursDecisionSchema)
  if (parsed.error) return parsed.error

  const now = new Date()
  const applied = await prisma.$transaction(async (tx) => {
    const changes: { kind: string; id: string; before: number | null; after: number }[] = []

    for (const decision of parsed.data.decisions) {
      if (decision.kind === "session") {
        const before = await tx.workSession.findUnique({
          where: { id: decision.id },
          select: { hoursApproved: true },
        })
        if (!before) continue
        await tx.workSession.update({
          where: { id: decision.id },
          data: {
            hoursApproved: decision.hoursApproved,
            reviewComments: sanitizeOptional(decision.comments),
            reviewedAt: now,
            reviewedById: gate.user.id,
          },
        })
        changes.push({
          kind: "session",
          id: decision.id,
          before: before.hoursApproved,
          after: decision.hoursApproved,
        })
      } else {
        const before = await tx.hackatimeLink.findUnique({
          where: { id: decision.id },
          select: { hoursApproved: true },
        })
        if (!before) continue
        await tx.hackatimeLink.update({
          where: { id: decision.id },
          data: {
            hoursApproved: decision.hoursApproved,
            reviewedAt: now,
            reviewedById: gate.user.id,
          },
        })
        changes.push({
          kind: "hackatime",
          id: decision.id,
          before: before.hoursApproved,
          after: decision.hoursApproved,
        })
      }
    }
    return changes
  })

  await logAudit({
    action: AuditAction.REVIEW_APPROVE_HOURS,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "WorkSession",
    targetId: applied[0]?.id ?? null,
    metadata: { changes: applied },
  })

  return ok({ updated: applied.length, changes: applied })
})
