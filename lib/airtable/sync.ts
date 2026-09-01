import "server-only"
import prisma from "@/lib/prisma"
import { Phase } from "@/app/generated/prisma/enums"
import { decryptUserPII } from "@/lib/pii"
import { publicUrlFor } from "@/lib/uploads/r2"
import { getHoursBreakdown } from "@/lib/hours"
import { buildHoursJustification } from "@/lib/justification"
import { getThemeDef } from "@/lib/config/program"
import { tierAirtableLabel } from "@/lib/config/tiers"
import { getProgramSettings } from "@/lib/program"
import { upsertYswsSubmission, deleteYswsSubmission, deleteUnifiedRecords } from "@/lib/airtable/ysws"

/**
 * Push one approved (themed project, phase) into the grant sink.
 *
 * The grant money rides on the Design row, because the tier's dollars are parts
 * money and the participant needs them before they can build. The Build row is
 * written at zero so the payout team has the full paper trail without a second
 * payment.
 */
export async function syncThemeProjectToYsws(
  themeProjectId: string,
  phase: Phase,
  opts: { reviewerName?: string | null; reviewerNote?: string | null } = {},
): Promise<{ recordId: string } | { skipped: string }> {
  const settings = await getProgramSettings()
  if (!settings.airtableSyncEnabled) return { skipped: "sync_disabled" }

  const project = await prisma.themeProject.findUnique({
    where: { id: themeProjectId },
    include: {
      user: true,
      submissions: {
        where: { phase },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  })
  if (!project) return { skipped: "project_not_found" }

  const pii = decryptUserPII(project.user)
  const breakdown = await getHoursBreakdown(themeProjectId, phase)
  const justification = await buildHoursJustification({
    themeProjectId,
    phase,
    reviewerName: opts.reviewerName,
    reviewerNote: opts.reviewerNote,
  })

  const [firstName, ...rest] = (project.user.name ?? "").trim().split(/\s+/)
  const submission = project.submissions[0]
  const stage = phase === Phase.DESIGN ? "Design" : "Build"

  return upsertYswsSubmission({
    halfLifeId: project.id,
    stage,
    theme: getThemeDef(project.theme).label,
    firstName: firstName ?? "",
    lastName: rest.join(" "),
    email: project.user.email,
    slackId: project.user.slackId,
    codeUrl: project.githubRepo,
    description: project.description,
    screenshotUrl: publicUrlFor(project.coverImageKey),
    addressLine1: pii.line1,
    addressLine2: pii.line2,
    city: pii.city,
    state: pii.state,
    country: pii.country,
    zip: pii.zip,
    birthday: pii.birthday,
    totalHours: breakdown.effectiveHours,
    hoursJustification: justification,
    // Only the Design row carries money.
    grantUsd: phase === Phase.DESIGN ? (project.grantUsd ?? 0) : 0,
    complexityTier: project.tier ? tierAirtableLabel(project.tier) : "",
    weekSubmitted: submission?.submittedInWeek ?? null,
    onTime: submission?.onTime ?? false,
    approvedAt:
      (phase === Phase.DESIGN ? project.designReviewedAt : project.buildReviewedAt)?.toISOString() ??
      null,
    reviewerName: opts.reviewerName ?? null,
  })
}

/** Remove a grant row and its unified-base twin, for an un-approval. */
export async function removeThemeProjectFromYsws(
  themeProjectId: string,
  phase: Phase,
): Promise<{ deleted: string[]; unifiedDeleted: string[]; skipped?: string }> {
  const stage = phase === Phase.DESIGN ? "Design" : "Build"
  const local = await deleteYswsSubmission(themeProjectId, stage)
  if (local.skipped) {
    return { deleted: local.deleted, unifiedDeleted: [], skipped: local.skipped }
  }
  const unified = await deleteUnifiedRecords(local.unifiedRecordIds)
  return { deleted: local.deleted, unifiedDeleted: unified.deleted, skipped: unified.skipped }
}

/** Themed projects whose approved phases have never made it upstream. */
export async function findUnsyncedApprovals(): Promise<
  { themeProjectId: string; phase: Phase }[]
> {
  const approved = await prisma.themeProject.findMany({
    where: {
      deletedAt: null,
      OR: [{ designStatus: "approved" }, { buildStatus: "approved" }],
    },
    select: { id: true, designStatus: true, buildStatus: true },
  })

  const synced = await prisma.auditLog.findMany({
    where: {
      action: "AIRTABLE_SYNC_SUCCESS",
      targetId: { in: approved.map((p) => p.id) },
    },
    select: { targetId: true, metadata: true },
  })
  const syncedKeys = new Set(
    synced.map((s) => {
      const meta = s.metadata as { phase?: string } | null
      return `${s.targetId}:${meta?.phase ?? ""}`
    }),
  )

  const out: { themeProjectId: string; phase: Phase }[] = []
  for (const p of approved) {
    if (p.designStatus === "approved" && !syncedKeys.has(`${p.id}:${Phase.DESIGN}`)) {
      out.push({ themeProjectId: p.id, phase: Phase.DESIGN })
    }
    if (p.buildStatus === "approved" && !syncedKeys.has(`${p.id}:${Phase.BUILD}`)) {
      out.push({ themeProjectId: p.id, phase: Phase.BUILD })
    }
  }
  return out
}
