import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSessionPage } from "@/lib/page-guards"
import { getProjectBySlug } from "@/lib/queries/project"
import { Phase } from "@/app/generated/prisma/enums"
import { getSubmitReadiness, canSubmitPhase } from "@/lib/submissions"
import { getHoursBreakdown } from "@/lib/hours"
import { themeDefBySlug } from "@/lib/config/program"
import { Callout, PageHeader, Panel } from "@/app/components/ui"
import { ActionButton } from "@/app/components/forms/ActionButton"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ theme: string; phase: string }> }

export default async function SubmitPage({ params }: Props) {
  const { user } = await requireSessionPage()
  const { theme, phase: phaseParam } = await params

  const def = themeDefBySlug(theme)
  const phase =
    phaseParam === "design" ? Phase.DESIGN : phaseParam === "build" ? Phase.BUILD : null
  if (!def || !phase) notFound()

  const project = await getProjectBySlug(user.id, theme)
  if (!project) notFound()

  const [readiness, breakdown] = await Promise.all([
    getSubmitReadiness(project, phase),
    getHoursBreakdown(project.id, phase),
  ])
  const eligible = canSubmitPhase(project, phase)

  return (
    <div className="hl-stack">
      <PageHeader
        title={`Submit ${phaseParam} — ${def.label}`}
        subtitle={`${breakdown.effectiveHours}h logged for this phase.`}
      />

      <Panel title="Before you submit">
        {/* This checklist is guidance. The submit route recomputes every one of
            these server-side, because a page rendered five minutes ago is not
            an authorisation. */}
        <ul className="hl-stack hl-stack--tight" style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {readiness.map((check) => (
            <li key={check.key} className={check.ok ? undefined : "hl-muted"}>
              {check.ok ? "✓" : "○"} {check.label}
              {check.detail ? ` — ${check.detail}` : ""}
            </li>
          ))}
        </ul>
      </Panel>

      {!eligible.ok ? (
        <Callout tone="warning">{eligible.message}</Callout>
      ) : (
        <Panel>
          <p style={{ marginTop: 0 }}>
            Submitting puts this phase in the review queue. You can withdraw it while it is
            unclaimed, but not once a reviewer has started.
          </p>
          <ActionButton
            url={`/api/projects/${project.id}/submit`}
            body={{ phase }}
            label={`Submit ${phaseParam}`}
            variant="primary"
          />
        </Panel>
      )}

      <p>
        <Link href={`/dashboard/${def.slug}`}>Back to {def.label}</Link>
      </p>
    </div>
  )
}
