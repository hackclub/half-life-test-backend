import { notFound } from "next/navigation"
import { requireSessionPage } from "@/lib/page-guards"
import { getProjectBySlug } from "@/lib/queries/project"
import { themeDefBySlug } from "@/lib/config/program"
import { PageHeader, Panel } from "@/app/components/ui"
import { SessionForm } from "@/app/components/forms/SessionForm"

export const dynamic = "force-dynamic"

type Props = {
  params: Promise<{ theme: string }>
  searchParams: Promise<{ phase?: string }>
}

export default async function LogSessionPage({ params, searchParams }: Props) {
  const { user } = await requireSessionPage()
  const { theme } = await params
  const { phase } = await searchParams

  const def = themeDefBySlug(theme)
  const project = await getProjectBySlug(user.id, theme)
  if (!def || !project) notFound()

  return (
    <div className="hl-stack">
      <PageHeader title={`Log work — ${def.label}`} subtitle="One entry per sitting." />
      <Panel>
        <SessionForm
          projectId={project.id}
          slug={def.slug}
          defaultPhase={phase === "DESIGN" ? "DESIGN" : phase === "BUILD" ? "BUILD" : "DESIGN"}
        />
      </Panel>
    </div>
  )
}
