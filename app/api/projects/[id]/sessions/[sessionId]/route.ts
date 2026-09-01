import prisma from "@/lib/prisma"
import { ok, fail, parseBody, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { sessionUpdateSchema } from "@/lib/schemas/session"
import { sanitize, sanitizeHtml } from "@/lib/sanitize"
import { getSubmissionAccess, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { AuditAction, logAudit } from "@/lib/audit"

type Params = { params: Promise<{ id: string; sessionId: string }> }

async function loadOwned(userId: string, projectId: string, sessionId: string) {
  return prisma.workSession.findFirst({
    where: {
      id: sessionId,
      themeProjectId: projectId,
      deletedAt: null,
      themeProject: { userId, deletedAt: null },
    },
  })
}

export const PATCH = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id, sessionId } = await params

  const parsed = await parseBody(req, sessionUpdateSchema)
  if (parsed.error) return parsed.error
  const data = parsed.data

  const session = await loadOwned(gate.user.id, id, sessionId)
  if (!session) return fail("NOT_FOUND", "Session not found")

  const access = await getSubmissionAccess(gate.user.id, id)
  if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

  // Once a reviewer has set hours on an entry, the participant editing it
  // would silently invalidate the number the review was based on.
  if (session.hoursApproved !== null) {
    return fail("PHASE_LOCKED", "This entry has been reviewed and can no longer be edited")
  }

  const updated = await prisma.workSession.update({
    where: { id: sessionId },
    data: {
      ...(data.title !== undefined ? { title: sanitize(data.title) } : {}),
      ...(data.content !== undefined
        ? { content: data.content ? sanitizeHtml(data.content) : null }
        : {}),
      ...(data.hoursClaimed !== undefined ? { hoursClaimed: data.hoursClaimed } : {}),
      ...(data.hoursSource !== undefined ? { hoursSource: data.hoursSource } : {}),
    },
  })

  await logAudit({
    action: AuditAction.USER_UPDATE_SESSION,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "WorkSession",
    targetId: sessionId,
    metadata: {
      before: { hoursClaimed: session.hoursClaimed, title: session.title },
      after: { hoursClaimed: updated.hoursClaimed, title: updated.title },
    },
  })

  return ok({ session: updated })
})

export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id, sessionId } = await params

  const session = await loadOwned(gate.user.id, id, sessionId)
  if (!session) return fail("NOT_FOUND", "Session not found")
  if (session.hoursApproved !== null) {
    return fail("PHASE_LOCKED", "This entry has been reviewed and can no longer be deleted")
  }

  await prisma.workSession.update({
    where: { id: sessionId },
    data: { deletedAt: new Date() },
  })

  await logAudit({
    action: AuditAction.USER_DELETE_SESSION,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "WorkSession",
    targetId: sessionId,
    metadata: { themeProjectId: id, hoursClaimed: session.hoursClaimed },
  })

  return ok({ ok: true })
})
