import type { NextRequest } from "next/server"
import { ok, withRoute } from "@/lib/api"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import { findUnsyncedApprovals, syncThemeProjectToYsws } from "@/lib/airtable/sync"
import { trackSideEffect } from "@/lib/side-effects"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/**
 * Replays grant-row writes that failed. Approval is the moment money is
 * decided; the row reaching Airtable is a separate, retryable step, and this is
 * what keeps a transient outage from turning into an unpaid participant.
 */
export const POST = withRoute(async (req: NextRequest) => {
  const denied = requireIntegrationAuth(req)
  if (denied) return denied

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "true"
  const pending = await findUnsyncedApprovals()

  if (dryRun) return ok({ dryRun: true, pending })

  let synced = 0
  let failed = 0
  for (const item of pending) {
    const result = await trackSideEffect(
      "airtable",
      {
        actorId: null,
        targetType: "ThemeProject",
        targetId: item.themeProjectId,
        metadata: { phase: item.phase, retry: true },
      },
      () => syncThemeProjectToYsws(item.themeProjectId, item.phase),
    )
    if (result) synced++
    else failed++
  }

  const summary = { attempted: pending.length, synced, failed }
  await recordSyncRun("airtable_ysws", summary)
  return ok(summary)
})
