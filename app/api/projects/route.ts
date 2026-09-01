import prisma from "@/lib/prisma"
import { ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { Phase } from "@/app/generated/prisma/enums"
import { getHoursBreakdown } from "@/lib/hours"
import { getThemeDef } from "@/lib/config/program"
import { materializeThemeProjects } from "@/lib/provisioning"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  await materializeThemeProjects(gate.user.id)

  const projects = await prisma.themeProject.findMany({
    where: { userId: gate.user.id, deletedAt: null },
  })

  const items = await Promise.all(
    projects.map(async (project) => {
      const [design, build] = await Promise.all([
        getHoursBreakdown(project.id, Phase.DESIGN),
        getHoursBreakdown(project.id, Phase.BUILD),
      ])
      const def = getThemeDef(project.theme)
      return {
        id: project.id,
        theme: project.theme,
        slug: def.slug,
        label: def.label,
        title: project.title,
        designStatus: project.designStatus,
        buildStatus: project.buildStatus,
        designWeek: def.designWeek,
        buildWeek: def.buildWeek,
        tier: project.tier,
        grantUsd: project.grantUsd,
        hours: { design: design.effectiveHours, build: build.effectiveHours },
      }
    }),
  )

  // Program order, not insertion order.
  items.sort((a, b) => a.designWeek - b.designWeek)
  return ok({ projects: items })
})
