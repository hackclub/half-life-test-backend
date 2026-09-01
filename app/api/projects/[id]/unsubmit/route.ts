import { ok, parseBody, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { unsubmitSchema } from "@/lib/schemas/project"
import { unsubmitPhase } from "@/lib/submissions"
import { AuditAction, logAudit } from "@/lib/audit"

type Params = { params: Promise<{ id: string }> }

export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, unsubmitSchema)
  if (parsed.error) return parsed.error

  await unsubmitPhase(gate.user.id, id, parsed.data.phase)

  await logAudit({
    action: AuditAction.USER_UNSUBMIT_PHASE,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "ThemeProject",
    targetId: id,
    metadata: { phase: parsed.data.phase },
  })

  return ok({ ok: true })
})
