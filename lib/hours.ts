import "server-only"
import prisma from "@/lib/prisma"
import { HoursSource, Phase } from "@/app/generated/prisma/enums"
import { fetchProjectSeconds } from "@/lib/hackatime"
import { getTierOrThrow, type TierId } from "@/lib/config/tiers"
import {
  CREDIT_PER_EXCESS_HOUR,
  MAX_EXCESS_CREDIT_PER_PROJECT,
} from "@/lib/config/program"

export interface HoursBreakdown {
  /** Sum over MANUAL sessions of (hoursApproved ?? hoursClaimed). */
  journalHours: number
  /** The same sum of hoursClaimed only, so the UI can show reviewer deflation. */
  journalHoursClaimed: number
  journalEntryCount: number

  hackatimeHours: number
  /** True when any link fell back to its cache. Blocks finalisation. */
  hackatimeStale: boolean

  /** Evidence only. Never part of any total. */
  timelapseSeconds: number
  /** timelapseSeconds / claimed seconds, clamped to [0, 1]. */
  timelapseCoverage: number

  /** journalHours + hackatimeHours. The reviewer's default. */
  computedTotal: number
  /** ThemeProject.approvedHours once frozen. */
  frozenTotal: number | null
  /** frozenTotal ?? computedTotal. The number every caller should use. */
  effectiveHours: number
}

/**
 * Journal hours and Hackatime hours are additive. Timelapse is not.
 *
 * A timelapse is a recording *of* a session whose hours were already claimed,
 * so adding its duration is a straight double-count. It surfaces instead as
 * `timelapseCoverage` — a session claiming six hours with five hours of
 * timelapse reads very differently from one with none.
 *
 * Journal and Hackatime can double-count too, which is what
 * `WorkSession.hoursSource` exists to prevent: a HACKATIME_TRACKED session
 * still exists as a journal entry and as evidence, but contributes zero hours
 * because its time already arrives through the link.
 */
export async function getHoursBreakdown(
  themeProjectId: string,
  phase: Phase,
  opts: { live?: boolean } = {},
): Promise<HoursBreakdown> {
  const live = opts.live ?? false

  const [project, sessions, links] = await Promise.all([
    prisma.themeProject.findUnique({
      where: { id: themeProjectId },
      select: {
        approvedHours: true,
        user: { select: { hackatimeUserId: true } },
      },
    }),
    prisma.workSession.findMany({
      where: { themeProjectId, phase, deletedAt: null },
      select: {
        hoursClaimed: true,
        hoursApproved: true,
        hoursSource: true,
        timelapses: { select: { coveredSeconds: true } },
      },
    }),
    prisma.hackatimeLink.findMany({
      where: { themeProjectId, phase },
      select: { id: true, hackatimeProject: true, hoursApproved: true, cachedSeconds: true },
    }),
  ])

  let journalHours = 0
  let journalHoursClaimed = 0
  let timelapseSeconds = 0

  for (const s of sessions) {
    for (const t of s.timelapses) timelapseSeconds += t.coveredSeconds ?? 0
    if (s.hoursSource === HoursSource.HACKATIME_TRACKED) continue
    journalHours += s.hoursApproved ?? s.hoursClaimed
    journalHoursClaimed += s.hoursClaimed
  }

  let hackatimeHours = 0
  let hackatimeStale = false
  const hackatimeUserId = project?.user.hackatimeUserId ?? null

  for (const link of links) {
    // A reviewer override replaces the live value permanently, so there is
    // nothing to fetch and nothing that can go stale.
    if (link.hoursApproved !== null) {
      hackatimeHours += link.hoursApproved
      continue
    }
    if (live && hackatimeUserId) {
      const result = await fetchProjectSeconds(hackatimeUserId, link.hackatimeProject)
      if (result.stale) {
        hackatimeStale = true
        hackatimeHours += (link.cachedSeconds ?? 0) / 3600
      } else {
        hackatimeHours += result.seconds / 3600
        await prisma.hackatimeLink.update({
          where: { id: link.id },
          data: { cachedSeconds: result.seconds, cachedAt: new Date(), lastFetchError: null },
        })
      }
    } else {
      if (link.cachedSeconds === null) hackatimeStale = true
      hackatimeHours += (link.cachedSeconds ?? 0) / 3600
    }
  }

  const claimedSeconds = journalHoursClaimed * 3600
  const computedTotal = round2(journalHours + hackatimeHours)
  const frozenTotal = project?.approvedHours ?? null

  return {
    journalHours: round2(journalHours),
    journalHoursClaimed: round2(journalHoursClaimed),
    journalEntryCount: sessions.length,
    hackatimeHours: round2(hackatimeHours),
    hackatimeStale,
    timelapseSeconds,
    timelapseCoverage:
      claimedSeconds > 0 ? Math.min(1, timelapseSeconds / claimedSeconds) : 0,
    computedTotal,
    frozenTotal,
    effectiveHours: frozenTotal ?? computedTotal,
  }
}

/**
 * Credit minted by hours beyond the tier's minimum.
 *
 * Capped because `approvedHours` can come from a reviewer typing into a box,
 * and a fat-fingered 1000 should not mint five thousand credits.
 */
export function excessCreditFor(tierId: TierId | number, approvedHours: number): number {
  const tier = getTierOrThrow(tierId)
  const excess = Math.max(0, approvedHours - tier.minHours)
  return Math.min(
    Math.floor(excess * CREDIT_PER_EXCESS_HOUR),
    MAX_EXCESS_CREDIT_PER_PROJECT,
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
