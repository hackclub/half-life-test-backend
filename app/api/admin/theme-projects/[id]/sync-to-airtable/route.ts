import { z } from "zod"
import { ok, parseBody, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { phaseSchema } from "@/lib/schemas/common"
import { syncThemeProjectToYsws } from "@/lib/airtable/sync"
import { trackSideEffect } from "@/lib/side-effects"

type Params = { params: Promise<{ id: string }> }

export const maxDuration = 60

const bodySchema = z.object({ phase: phaseSchema }).strict()

/**
 * Replay a grant-row write that failed the first time.
 *
 * The audit log is where a failed sync shows up; this is how an admin fixes it
 * without re-running the whole review.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.MANAGE_PROGRAM)
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, bodySchema)
  if (parsed.error) return parsed.error

  const result = await trackSideEffect(
    "airtable",
    {
      actorId: gate.user.id,
      actorEmail: gate.user.email,
      targetType: "ThemeProject",
      targetId: id,
      metadata: { phase: parsed.data.phase, manual: true },
    },
    () =>
      syncThemeProjectToYsws(id, parsed.data.phase, {
        reviewerName: gate.user.name,
      }),
  )

  return ok({ result })
})
