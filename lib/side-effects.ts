import "server-only"
import { AuditAction, logAudit } from "@/lib/audit"
import type { Prisma } from "@/app/generated/prisma/client"

export interface SideEffectContext {
  actorId: string | null
  actorEmail?: string | null
  targetType: string
  targetId: string
  metadata?: Prisma.InputJsonValue
}

/**
 * Run an external side effect so its outcome becomes a queryable audit row
 * rather than a swallowed console error.
 *
 * The reviewer never sees these failures — the audit log is the operational
 * signal an admin queries to spot a regression, and the recovery route
 * (`POST /api/admin/theme-projects/[id]/sync-to-airtable`) is how they fix it.
 */
export async function trackSideEffect<T>(
  kind: "airtable" | "slack",
  ctx: SideEffectContext,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    const result = await fn()
    if (kind === "airtable") {
      await logAudit({
        action: AuditAction.AIRTABLE_SYNC_SUCCESS,
        actorId: ctx.actorId,
        actorEmail: ctx.actorEmail,
        targetType: ctx.targetType,
        targetId: ctx.targetId,
        metadata: ctx.metadata,
      })
    }
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[side-effect] ${kind} failed for ${ctx.targetType}:${ctx.targetId}:`, err)
    await logAudit({
      action:
        kind === "airtable"
          ? AuditAction.AIRTABLE_SYNC_FAILURE
          : AuditAction.NOTIFICATION_FAILURE,
      actorId: ctx.actorId,
      actorEmail: ctx.actorEmail,
      targetType: ctx.targetType,
      targetId: ctx.targetId,
      metadata: { ...(typeof ctx.metadata === "object" ? ctx.metadata : {}), error: message },
    })
    return null
  }
}
