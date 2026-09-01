import "server-only"
import prisma from "@/lib/prisma"
import {
  LedgerKind,
  Phase,
  PhaseStatus,
  ReviewPass,
  ReviewResult,
} from "@/app/generated/prisma/enums"
import type { Prisma } from "@/app/generated/prisma/client"
import { HttpError } from "@/lib/errors"
import { excessCreditFor, getHoursBreakdown } from "@/lib/hours"
import { reconcileGrant } from "@/lib/currency"
import { ensurePrinterAward } from "@/lib/printer"
import { getTierOrThrow, isTierId } from "@/lib/config/tiers"
import { THEME_COMPLETION_BONUS, getThemeDef } from "@/lib/config/program"
import { getProgramSettings } from "@/lib/program"
import { AuditAction, logAudit } from "@/lib/audit"

// ─── Claim locks ─────────────────────────────────────────────────────────────

export type ClaimResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; heldBy: string; heldByName: string | null; expiresAt: Date }

/**
 * Take an exclusive lock on a submission.
 *
 * `submissionId` is unique, so this is a single insert that either succeeds or
 * collides. Never implement claiming as read-then-write: two reviewers opening
 * the queue at the same moment both read "unclaimed" and both proceed.
 */
export async function claimSubmission(
  submissionId: string,
  reviewerId: string,
): Promise<ClaimResult> {
  const settings = await getProgramSettings()
  const expiresAt = new Date(Date.now() + settings.reviewClaimTtlMinutes * 60_000)

  // Opportunistically clear a dead reviewer's lock so a queue isn't blocked for
  // up to a full sweep interval.
  await prisma.reviewClaim.deleteMany({
    where: { submissionId, OR: [{ expiresAt: { lt: new Date() } }, { reviewerId }] },
  })

  try {
    await prisma.reviewClaim.create({ data: { submissionId, reviewerId, expiresAt } })
    return { ok: true, expiresAt }
  } catch {
    const held = await prisma.reviewClaim.findUnique({
      where: { submissionId },
      include: { reviewer: { select: { name: true } } },
    })
    if (!held) throw new HttpError("CONFLICT", "Could not claim this submission")
    return {
      ok: false,
      heldBy: held.reviewerId,
      heldByName: held.reviewer.name,
      expiresAt: held.expiresAt,
    }
  }
}

export async function releaseClaim(submissionId: string, reviewerId: string): Promise<void> {
  const claim = await prisma.reviewClaim.findUnique({ where: { submissionId } })
  if (!claim) return
  if (claim.reviewerId !== reviewerId) {
    throw new HttpError("FORBIDDEN", "That claim belongs to another reviewer")
  }
  await prisma.reviewClaim.delete({ where: { submissionId } })
}

export async function sweepExpiredClaims(): Promise<number> {
  const { count } = await prisma.reviewClaim.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return count
}

// ─── Decisions ───────────────────────────────────────────────────────────────

export interface FinalizeInput {
  submissionId: string
  reviewerId: string
  reviewerName: string | null
  reviewerEmail: string | null
  result: ReviewResult
  /** Shown to the participant. */
  feedback: string
  /** Internal, feeds the grant row's hours justification. */
  reason?: string | null
  /** Required on a design approval. */
  tier?: number | null
  /** Replaces the computed hours total outright. */
  hoursOverride?: number | null
  grantUsdOverride?: number | null
}

export interface FinalizeOutcome {
  themeProjectId: string
  phase: Phase
  result: ReviewResult
  approvedHours: number | null
  tier: number | null
  grantUsd: number | null
  excessCredit: number | null
  printerQualified: boolean
}

/**
 * Record a review decision and move everything that depends on it.
 *
 * The whole thing is one transaction because a partial application — status
 * moved but credit not written, or credit written twice — is the failure that
 * costs real money.
 */
export async function finalizeReview(input: FinalizeInput): Promise<FinalizeOutcome> {
  const submission = await prisma.phaseSubmission.findUnique({
    where: { id: input.submissionId },
    include: { themeProject: { include: { user: { select: { id: true } } } }, claim: true },
  })
  if (!submission) throw new HttpError("NOT_FOUND", "Submission not found")
  if (submission.resolvedAt) {
    throw new HttpError("ALREADY_RESOLVED", "This submission has already been decided")
  }
  if (
    submission.claim &&
    submission.claim.reviewerId !== input.reviewerId &&
    submission.claim.expiresAt > new Date()
  ) {
    throw new HttpError("CLAIMED_BY_OTHER", "Another reviewer holds the claim on this submission")
  }

  const project = submission.themeProject
  const phase = submission.phase
  const approving = input.result === ReviewResult.APPROVED

  // A build cannot be approved before its design is. Submitting out of order is
  // fine — see canSubmitPhase — but paying out of order is not.
  if (approving && phase === Phase.BUILD && project.designStatus !== PhaseStatus.approved) {
    throw new HttpError(
      "DESIGN_NOT_APPROVED",
      "Approve the design phase for this theme before approving the build",
    )
  }

  let tier = project.tier
  if (approving && phase === Phase.DESIGN) {
    // The tier's dollars are parts money, so the decision lands here — before
    // the participant starts building — not at build approval.
    const chosen = input.tier ?? project.tier
    if (!isTierId(chosen)) {
      throw new HttpError("VALIDATION_FAILED", "Assign a funding tier when approving a design")
    }
    tier = chosen
  }

  const breakdown = await getHoursBreakdown(project.id, phase, { live: approving })
  if (approving && breakdown.hackatimeStale) {
    // Refusing here is the point: stasis's client returns 0 on a Hackatime
    // timeout and that zero flows into the grant row, silently underpaying
    // someone with no trace.
    throw new HttpError(
      "HACKATIME_STALE",
      "Hackatime data could not be refreshed. Retry, or set an explicit hours override.",
    )
  }

  const approvedHours = approving
    ? (input.hoursOverride ?? breakdown.computedTotal)
    : null

  const grantUsd =
    approving && phase === Phase.DESIGN && tier
      ? (input.grantUsdOverride ?? getTierOrThrow(tier).grantUsd)
      : project.grantUsd

  const excessCredit =
    approving && phase === Phase.BUILD && tier && approvedHours !== null
      ? excessCreditFor(tier, approvedHours)
      : null

  const nextStatus: PhaseStatus =
    input.result === ReviewResult.APPROVED
      ? PhaseStatus.approved
      : input.result === ReviewResult.RETURNED
        ? PhaseStatus.update_requested
        : PhaseStatus.rejected

  const outcome = await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: the review page may have been open for a
    // while, and the participant may have withdrawn in the meantime.
    const fresh = await tx.phaseSubmission.findUnique({
      where: { id: input.submissionId },
      select: { resolvedAt: true },
    })
    if (!fresh) throw new HttpError("NOT_SUBMITTED", "This submission has been withdrawn")
    if (fresh.resolvedAt) throw new HttpError("ALREADY_RESOLVED", "Already decided")

    if (approving) {
      // Accept every unreviewed session at its claimed hours, so the
      // per-session numbers stay consistent with the frozen total.
      await tx.workSession.updateMany({
        where: { themeProjectId: project.id, phase, deletedAt: null, hoursApproved: null },
        data: { reviewedAt: new Date(), reviewedById: input.reviewerId },
      })
    }

    await tx.submissionReview.create({
      data: {
        submissionId: input.submissionId,
        reviewerId: input.reviewerId,
        pass: ReviewPass.FINAL,
        result: input.result,
        feedback: input.feedback,
        reason: input.reason ?? null,
        hoursOverride: input.hoursOverride ?? null,
        tierOverride: input.tier ?? null,
        grantUsdOverride: input.grantUsdOverride ?? null,
        // Freeze what the reviewer was looking at. The tier table is expected
        // to change mid-program, so without these there is no way to
        // reconstruct why anyone was paid what they were paid.
        frozenJournalHours: breakdown.journalHours,
        frozenHackatimeHours: breakdown.hackatimeHours,
        frozenTimelapseSeconds: breakdown.timelapseSeconds,
        frozenEntryCount: breakdown.journalEntryCount,
        frozenApprovedHours: approvedHours,
        frozenTier: tier,
        frozenGrantUsd: grantUsd,
        frozenExcessCredit: excessCredit,
      },
    })

    await tx.phaseSubmission.update({
      where: { id: input.submissionId },
      data: { resolvedAt: new Date(), resolvedResult: input.result },
    })

    const projectUpdate: Prisma.ThemeProjectUpdateInput =
      phase === Phase.DESIGN
        ? {
            designStatus: nextStatus,
            designReviewComments: input.feedback,
            designReviewedAt: new Date(),
            designReviewedById: input.reviewerId,
            ...(approving ? { tier, grantUsd, grantEmittedAt: new Date() } : {}),
          }
        : {
            buildStatus: nextStatus,
            buildReviewComments: input.feedback,
            buildReviewedAt: new Date(),
            buildReviewedById: input.reviewerId,
            ...(approving
              ? { approvedHours, approvedHoursAt: new Date(), excessCredit }
              : {}),
          }

    await tx.themeProject.update({ where: { id: project.id }, data: projectUpdate })

    // Credit is reconciled to a target rather than appended, so approving the
    // same build five times converges instead of compounding.
    if (phase === Phase.BUILD) {
      await reconcileGrant(tx, {
        userId: project.userId,
        themeProjectId: project.id,
        kind: LedgerKind.EXCESS_HOURS,
        target: approving ? (excessCredit ?? 0) : 0,
        note: approving
          ? `${approvedHours}h approved against a ${tier ? getTierOrThrow(tier).minHours : "?"}h Tier ${tier} minimum`
          : "Build approval withdrawn",
        createdById: input.reviewerId,
      })
      await reconcileGrant(tx, {
        userId: project.userId,
        themeProjectId: project.id,
        kind: LedgerKind.THEME_COMPLETION_BONUS,
        target: approving ? THEME_COMPLETION_BONUS : 0,
        note: `${getThemeDef(project.theme).label} shipped`,
        createdById: input.reviewerId,
      })
    }

    await tx.reviewClaim.deleteMany({ where: { submissionId: input.submissionId } })

    const award = approving ? await ensurePrinterAward(tx, project.userId) : null

    return {
      themeProjectId: project.id,
      phase,
      result: input.result,
      approvedHours,
      tier,
      grantUsd,
      excessCredit,
      printerQualified: !!award,
    }
  })

  await logAudit({
    action:
      input.result === ReviewResult.APPROVED
        ? AuditAction.REVIEW_APPROVE
        : input.result === ReviewResult.RETURNED
          ? AuditAction.REVIEW_RETURN
          : AuditAction.REVIEW_REJECT,
    actorId: input.reviewerId,
    actorEmail: input.reviewerEmail,
    targetType: "ThemeProject",
    targetId: project.id,
    metadata: {
      phase,
      submissionId: input.submissionId,
      before: {
        status: phase === Phase.DESIGN ? project.designStatus : project.buildStatus,
        tier: project.tier,
        grantUsd: project.grantUsd,
        approvedHours: project.approvedHours,
      },
      after: {
        status: nextStatus,
        tier: outcome.tier,
        grantUsd: outcome.grantUsd,
        approvedHours: outcome.approvedHours,
        excessCredit: outcome.excessCredit,
      },
    },
  })

  return outcome
}

/**
 * Reverse an approval.
 *
 * Because credit is reconciled to a target, undoing is the same call with
 * `target: 0` — there is no separate reversal code path, so there is no
 * separate reversal code path to get wrong.
 */
export async function unapprovePhase(
  themeProjectId: string,
  phase: Phase,
  adminId: string,
  adminEmail: string | null,
  reason: string,
): Promise<void> {
  const project = await prisma.themeProject.findUnique({ where: { id: themeProjectId } })
  if (!project) throw new HttpError("NOT_FOUND", "Project not found")

  const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
  if (status !== PhaseStatus.approved) {
    throw new HttpError("CONFLICT", "That phase is not approved")
  }

  await prisma.$transaction(async (tx) => {
    await tx.submissionReview.updateMany({
      where: { submission: { themeProjectId, phase }, invalidated: false },
      data: { invalidated: true, invalidatedAt: new Date() },
    })

    await tx.themeProject.update({
      where: { id: themeProjectId },
      data:
        phase === Phase.DESIGN
          ? {
              designStatus: PhaseStatus.update_requested,
              designReviewComments: reason,
              tier: null,
              grantUsd: null,
              grantEmittedAt: null,
            }
          : {
              buildStatus: PhaseStatus.update_requested,
              buildReviewComments: reason,
              approvedHours: null,
              approvedHoursAt: null,
              excessCredit: null,
            },
    })

    if (phase === Phase.BUILD) {
      await reconcileGrant(tx, {
        userId: project.userId,
        themeProjectId,
        kind: LedgerKind.EXCESS_HOURS,
        target: 0,
        note: `Build un-approved: ${reason}`,
        createdById: adminId,
      })
      await reconcileGrant(tx, {
        userId: project.userId,
        themeProjectId,
        kind: LedgerKind.THEME_COMPLETION_BONUS,
        target: 0,
        note: `Build un-approved: ${reason}`,
        createdById: adminId,
      })
    }
  })

  await logAudit({
    action: AuditAction.ADMIN_UNAPPROVE_PHASE,
    actorId: adminId,
    actorEmail: adminEmail,
    targetType: "ThemeProject",
    targetId: themeProjectId,
    metadata: { phase, reason, before: { status: PhaseStatus.approved } },
  })
}

/** Bring a rejected phase back into play. Rejection is not terminal forever. */
export async function reopenPhase(
  themeProjectId: string,
  phase: Phase,
  adminId: string,
  adminEmail: string | null,
  reason: string,
): Promise<void> {
  const project = await prisma.themeProject.findUnique({ where: { id: themeProjectId } })
  if (!project) throw new HttpError("NOT_FOUND", "Project not found")

  const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
  if (status !== PhaseStatus.rejected) {
    throw new HttpError("CONFLICT", "That phase is not rejected")
  }

  await prisma.themeProject.update({
    where: { id: themeProjectId },
    data:
      phase === Phase.DESIGN
        ? { designStatus: PhaseStatus.update_requested, designReviewComments: reason }
        : { buildStatus: PhaseStatus.update_requested, buildReviewComments: reason },
  })

  await logAudit({
    action: AuditAction.ADMIN_REOPEN_PHASE,
    actorId: adminId,
    actorEmail: adminEmail,
    targetType: "ThemeProject",
    targetId: themeProjectId,
    metadata: { phase, reason },
  })
}
