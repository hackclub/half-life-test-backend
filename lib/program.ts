import "server-only"
import prisma from "@/lib/prisma"
import { Phase } from "@/app/generated/prisma/enums"
import type { ProgramSettings } from "@/app/generated/prisma/client"
import {
  DEFAULT_EVENT_START_DATE,
  DEFAULT_PROGRAM_TIMEZONE,
  TOTAL_WEEKS,
} from "@/lib/config/program"

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/**
 * The settings row is created on demand so a fresh database is usable without a
 * seed step having run first.
 */
export async function getProgramSettings(): Promise<ProgramSettings> {
  const existing = await prisma.programSettings.findUnique({ where: { id: "singleton" } })
  if (existing) return existing
  return prisma.programSettings.create({
    data: {
      id: "singleton",
      eventStartDate: new Date(`${DEFAULT_EVENT_START_DATE}T00:00:00.000Z`),
      programTimezone: DEFAULT_PROGRAM_TIMEZONE,
    },
  })
}

/**
 * Program week for a date. Week 1 is the seven days from eventStartDate.
 * Returns 0 before the program opens and TOTAL_WEEKS + 1 or higher after it
 * ends, so callers can distinguish "not started" from "over" without a second
 * query.
 */
export function weekNumberForDate(start: Date, date: Date): number {
  const elapsed = date.getTime() - start.getTime()
  if (elapsed < 0) return 0
  return Math.floor(elapsed / WEEK_MS) + 1
}

export function weekDateRange(start: Date, week: number): { start: Date; end: Date } | null {
  if (week < 1 || week > TOTAL_WEEKS) return null
  const weekStart = new Date(start.getTime() + (week - 1) * WEEK_MS)
  // End of the last day, not the start of the next week, so a "closes on"
  // label reads correctly.
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS - 1)
  return { start: weekStart, end: weekEnd }
}

export async function currentWeekNumber(): Promise<number> {
  const settings = await getProgramSettings()
  return weekNumberForDate(settings.eventStartDate, new Date())
}

/**
 * The YYYY-MM-DD a moment falls on in the program's timezone.
 *
 * Doing this in the program timezone rather than the server's is not
 * pedantry: siege computes week buckets against the server clock, so its
 * per-week hour totals shift if the container moves region.
 */
export function effectiveDateFor(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

export function formatProgramDate(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

// ─── Access gates ────────────────────────────────────────────────────────────

export type SubmissionAccessReason =
  | "OPEN"
  | "USER_EXTENSION"
  | "PROJECT_EXTENSION"
  | "CLOSED"
  | "NOT_STARTED"

export interface SubmissionAccess {
  open: boolean
  reason: SubmissionAccessReason
  closesAt: Date | null
  extensionUntil: Date | null
}

/**
 * Whether this participant may still write to this project.
 *
 * Two levels of override, both as columns rather than manual database surgery:
 * a per-user one covering everything they do, and a per-project one. Either
 * being in the future opens the gate.
 */
export async function getSubmissionAccess(
  userId: string,
  themeProjectId?: string,
): Promise<SubmissionAccess> {
  const now = new Date()
  const [settings, user, project] = await Promise.all([
    getProgramSettings(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { submissionExtensionUntil: true },
    }),
    themeProjectId
      ? prisma.themeProject.findUnique({
          where: { id: themeProjectId },
          select: { submissionExtensionUntil: true },
        })
      : Promise.resolve(null),
  ])

  const userExt = user?.submissionExtensionUntil ?? null
  const projectExt = project?.submissionExtensionUntil ?? null

  const globallyOpen =
    settings.submissionsOpen &&
    (!settings.submissionsCloseAt || settings.submissionsCloseAt > now)

  if (globallyOpen) {
    return {
      open: true,
      reason: "OPEN",
      closesAt: settings.submissionsCloseAt,
      extensionUntil: null,
    }
  }
  if (userExt && userExt > now) {
    return {
      open: true,
      reason: "USER_EXTENSION",
      closesAt: settings.submissionsCloseAt,
      extensionUntil: userExt,
    }
  }
  if (projectExt && projectExt > now) {
    return {
      open: true,
      reason: "PROJECT_EXTENSION",
      closesAt: settings.submissionsCloseAt,
      extensionUntil: projectExt,
    }
  }
  return {
    open: false,
    reason: "CLOSED",
    closesAt: settings.submissionsCloseAt,
    extensionUntil: null,
  }
}

export const SUBMISSIONS_CLOSED_MESSAGE =
  "Submissions are closed. If you need an extension, ask in the Slack channel."

export type ShopAccessReason = "OPEN" | "PENDING_REVIEW" | "GRACE_PERIOD" | "CLOSED"

export interface ShopAccess {
  open: boolean
  reason: ShopAccessReason
  closesAt: Date | null
  graceUntil: Date | null
}

/**
 * The shop stays open past its close date for anyone with work still in the
 * queue, and for a grace window after their last review — otherwise credit
 * awarded at the buzzer is unspendable through no fault of the participant.
 */
export async function getShopAccess(userId: string): Promise<ShopAccess> {
  const now = new Date()
  const settings = await getProgramSettings()

  const closesAt = settings.shopClosesAt
  const beforeClose = !closesAt || closesAt > now

  if (settings.shopOpen && beforeClose) {
    return { open: true, reason: "OPEN", closesAt, graceUntil: null }
  }
  if (!settings.shopOpen) {
    return { open: false, reason: "CLOSED", closesAt, graceUntil: null }
  }

  const [awaitingReview, lastReview] = await Promise.all([
    prisma.themeProject.count({
      where: { userId, deletedAt: null, OR: [{ designStatus: "in_review" }, { buildStatus: "in_review" }] },
    }),
    prisma.themeProject.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { designReviewedAt: true, buildReviewedAt: true },
    }),
  ])

  if (awaitingReview > 0) {
    return { open: true, reason: "PENDING_REVIEW", closesAt, graceUntil: null }
  }

  const reviewedAt = [lastReview?.designReviewedAt, lastReview?.buildReviewedAt]
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0]

  if (reviewedAt) {
    const graceUntil = new Date(reviewedAt.getTime() + settings.shopGraceDays * DAY_MS)
    if (graceUntil > now) {
      return { open: true, reason: "GRACE_PERIOD", closesAt, graceUntil }
    }
  }
  return { open: false, reason: "CLOSED", closesAt, graceUntil: null }
}

export const SHOP_CLOSED_MESSAGE =
  "The shop is closed. It stays open while you have work awaiting review, and for a short window after your last review."

export function phaseStatusField(phase: Phase): "designStatus" | "buildStatus" {
  return phase === Phase.DESIGN ? "designStatus" : "buildStatus"
}
