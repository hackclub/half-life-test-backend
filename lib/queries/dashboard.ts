import "server-only"
import prisma from "@/lib/prisma"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { getBalance, getEarnedCredit } from "@/lib/currency"
import { getHoursBreakdown } from "@/lib/hours"
import { getPrinterQualification } from "@/lib/printer"
import { currentWeekNumber, getProgramSettings, weekDateRange } from "@/lib/program"
import { THEMES, getThemeDef, scheduleForWeek } from "@/lib/config/program"
import { materializeThemeProjects } from "@/lib/provisioning"

export interface ThemeCard {
  id: string
  theme: string
  slug: string
  label: string
  blurb: string
  title: string
  designStatus: PhaseStatus
  buildStatus: PhaseStatus
  designWeek: number
  buildWeek: number
  tier: number | null
  grantUsd: number | null
  designHours: number
  buildHours: number
  shipped: boolean
}

export interface DashboardData {
  currentWeek: number
  weekRange: { start: Date; end: Date } | null
  focus: { themeLabel: string; phase: Phase } | null
  timezone: string
  balance: number
  earned: number
  printer: Awaited<ReturnType<typeof getPrinterQualification>>
  cards: ThemeCard[]
}

export async function getDashboard(userId: string): Promise<DashboardData> {
  // Self-heal: anyone whose signup hook failed still gets a working dashboard.
  await materializeThemeProjects(userId)

  const [settings, currentWeek, projects, balance, earned, printer] = await Promise.all([
    getProgramSettings(),
    currentWeekNumber(),
    prisma.themeProject.findMany({ where: { userId, deletedAt: null } }),
    prisma.$transaction((tx) => getBalance(tx, userId)),
    prisma.$transaction((tx) => getEarnedCredit(tx, userId)),
    getPrinterQualification(userId),
  ])

  const byTheme = new Map(projects.map((p) => [p.theme, p]))

  const cards: ThemeCard[] = []
  for (const def of THEMES) {
    const project = byTheme.get(def.id)
    if (!project) continue
    const [design, build] = await Promise.all([
      getHoursBreakdown(project.id, Phase.DESIGN),
      getHoursBreakdown(project.id, Phase.BUILD),
    ])
    cards.push({
      id: project.id,
      theme: project.theme,
      slug: def.slug,
      label: def.label,
      blurb: def.blurb,
      title: project.title,
      designStatus: project.designStatus,
      buildStatus: project.buildStatus,
      designWeek: def.designWeek,
      buildWeek: def.buildWeek,
      tier: project.tier,
      grantUsd: project.grantUsd,
      designHours: design.effectiveHours,
      buildHours: build.effectiveHours,
      shipped:
        project.designStatus === PhaseStatus.approved &&
        project.buildStatus === PhaseStatus.approved,
    })
  }

  const scheduled = scheduleForWeek(currentWeek)

  return {
    currentWeek,
    weekRange: weekDateRange(settings.eventStartDate, currentWeek),
    focus: scheduled
      ? { themeLabel: getThemeDef(scheduled.theme.id).label, phase: scheduled.phase }
      : null,
    timezone: settings.programTimezone,
    balance,
    earned,
    printer,
    cards,
  }
}
