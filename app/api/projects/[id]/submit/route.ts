import { after } from "next/server"
import { ok, parseBody, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { submitSchema } from "@/lib/schemas/project"
import { sanitizeOptional } from "@/lib/sanitize"
import { submitPhase } from "@/lib/submissions"
import { refreshLinkCache } from "@/lib/hackatime"
import prisma from "@/lib/prisma"
import { AuditAction, logAudit } from "@/lib/audit"

type Params = { params: Promise<{ id: string }> }

export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, submitSchema)
  if (parsed.error) return parsed.error

  const submission = await submitPhase(
    gate.user.id,
    id,
    parsed.data.phase,
    sanitizeOptional(parsed.data.notes),
  )

  await logAudit({
    action: AuditAction.USER_SUBMIT_PHASE,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "ThemeProject",
    targetId: id,
    metadata: { phase: parsed.data.phase, submissionId: submission.id },
  })

  // Warm the Hackatime cache now so the reviewer opens a page with fresh
  // numbers instead of waiting on the API. The participant does not need to
  // wait for it.
  after(async () => {
    const links = await prisma.hackatimeLink.findMany({
      where: { themeProjectId: id, phase: parsed.data.phase },
      select: { id: true },
    })
    for (const link of links) {
      await refreshLinkCache(link.id).catch((err) =>
        console.error("[submit] hackatime refresh failed:", err),
      )
    }
  })

  return ok({ submission }, { status: 201 })
})
