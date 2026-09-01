import prisma from "@/lib/prisma"
import { ok, fail, parseBody, parseQuery, withRoute } from "@/lib/api"
import type { NextRequest } from "next/server"
import { requireSession } from "@/lib/guards"
import { PhaseStatus } from "@/app/generated/prisma/enums"
import { sessionCreateSchema } from "@/lib/schemas/session"
import { sanitize, sanitizeHtml } from "@/lib/sanitize"
import { paginationQuery, cursorArgs, pageResult } from "@/lib/pagination"
import { stampSessionTiming } from "@/lib/submissions"
import { getSubmissionAccess, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { publicUrlFor } from "@/lib/uploads/r2"
import { AuditAction, logAudit } from "@/lib/audit"

type Params = { params: Promise<{ id: string }> }

export const GET = withRoute(async (req: NextRequest, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const query = parseQuery(req, paginationQuery)
  if (query.error) return query.error

  const project = await prisma.themeProject.findFirst({
    where: { id, userId: gate.user.id, deletedAt: null },
    select: { id: true },
  })
  if (!project) return fail("NOT_FOUND", "Project not found")

  const rows = await prisma.workSession.findMany({
    where: { themeProjectId: id, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...cursorArgs(query.data.cursor, query.data.limit),
    include: { media: true, timelapses: true },
  })

  const page = pageResult(rows, query.data.limit)
  return ok({
    items: page.items.map((s) => ({
      ...s,
      media: s.media.map((m) => ({ ...m, url: publicUrlFor(m.objectKey) })),
    })),
    nextCursor: page.nextCursor,
  })
})

export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, sessionCreateSchema)
  if (parsed.error) return parsed.error
  const data = parsed.data

  const project = await prisma.themeProject.findFirst({
    where: { id, userId: gate.user.id, deletedAt: null },
  })
  if (!project) return fail("NOT_FOUND", "Project not found")

  const access = await getSubmissionAccess(gate.user.id, id)
  if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

  const phaseStatus =
    data.phase === "DESIGN" ? project.designStatus : project.buildStatus
  if (phaseStatus === PhaseStatus.in_review) {
    return fail("PHASE_LOCKED", "This phase is in review — unsubmit before logging more work")
  }

  const timing = await stampSessionTiming(new Date())

  const session = await prisma.workSession.create({
    data: {
      themeProjectId: id,
      phase: data.phase,
      title: sanitize(data.title),
      content: data.content ? sanitizeHtml(data.content) : null,
      hoursClaimed: data.hoursClaimed,
      hoursSource: data.hoursSource,
      effectiveDate: timing.effectiveDate,
      weekNumber: timing.weekNumber,
      media: {
        create: data.media.map((m, i) => ({
          type: m.type,
          objectKey: m.objectKey,
          contentType: m.contentType ?? null,
          byteSize: m.byteSize ?? null,
          sortOrder: i,
        })),
      },
      timelapses: {
        create: data.timelapses.map((t) => ({
          objectKey: t.objectKey ?? null,
          playbackUrl: t.playbackUrl ?? null,
          coveredSeconds: t.coveredSeconds ?? null,
          runtimeSeconds: t.runtimeSeconds ?? null,
          speedupFactor: t.speedupFactor ?? null,
        })),
      },
    },
    include: { media: true, timelapses: true },
  })

  await logAudit({
    action: AuditAction.USER_CREATE_SESSION,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "WorkSession",
    targetId: session.id,
    metadata: {
      themeProjectId: id,
      phase: data.phase,
      hoursClaimed: data.hoursClaimed,
      hoursSource: data.hoursSource,
    },
  })

  return ok({ session }, { status: 201 })
})
