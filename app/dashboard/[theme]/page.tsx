import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSessionPage } from "@/lib/page-guards"
import { getProjectDetail } from "@/lib/queries/project"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { publicUrlFor } from "@/lib/uploads/r2"
import {
  Badge,
  Callout,
  EmptyState,
  Panel,
  PageHeader,
  Table,
  statusLabel,
  statusTone,
} from "@/app/components/ui"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { ProjectMetaForm } from "@/app/components/forms/ProjectMetaForm"
import { HackatimeLinkForm } from "@/app/components/forms/HackatimeLinkForm"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ theme: string }> }

export default async function ThemePage({ params }: Params) {
  const { user } = await requireSessionPage()
  const { theme } = await params

  const detail = await getProjectDetail(user.id, theme)
  if (!detail) notFound()

  const hackatimeLinked = await prisma.user
    .findUnique({ where: { id: user.id }, select: { hackatimeUserId: true } })
    .then((u) => !!u?.hackatimeUserId)

  const inReview =
    detail.project.designStatus === PhaseStatus.in_review ||
    detail.project.buildStatus === PhaseStatus.in_review

  const phases = [
    {
      phase: Phase.DESIGN,
      label: "Design",
      week: detail.designWeek,
      status: detail.project.designStatus,
      comments: detail.project.designReviewComments,
      hours: detail.design,
      readiness: detail.designReadiness,
      canSubmit: detail.canSubmitDesign,
    },
    {
      phase: Phase.BUILD,
      label: "Build",
      week: detail.buildWeek,
      status: detail.project.buildStatus,
      comments: detail.project.buildReviewComments,
      hours: detail.build,
      readiness: detail.buildReadiness,
      canSubmit: detail.canSubmitBuild,
    },
  ]

  return (
    <div className="hl-stack">
      <PageHeader
        title={detail.themeLabel}
        subtitle={`Design week ${detail.designWeek} · build week ${detail.buildWeek}`}
        actions={
          detail.project.tier ? <Badge tone="success">Tier {detail.project.tier}</Badge> : null
        }
      />

      {detail.project.grantUsd !== null ? (
        <Callout>
          Approved at Tier {detail.project.tier} for a ${detail.project.grantUsd} parts grant.
        </Callout>
      ) : null}

      {phases.map((p) => (
        <Panel
          key={p.phase}
          title={`${p.label} — week ${p.week}`}
          actions={<Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge>}
        >
          <p className="hl-hint" style={{ margin: 0 }}>
            {p.hours.journalHours}h journal
            {p.hours.hackatimeHours > 0 ? ` · ${p.hours.hackatimeHours}h Hackatime` : ""}
            {p.hours.timelapseSeconds > 0
              ? ` · timelapse covers ${Math.round(p.hours.timelapseCoverage * 100)}%`
              : ""}
            {" · "}
            <strong>{p.hours.effectiveHours}h total</strong>
          </p>

          {p.comments ? (
            <Callout tone={p.status === PhaseStatus.approved ? undefined : "warning"}>
              <strong>Reviewer:</strong> {p.comments}
            </Callout>
          ) : null}

          <ul className="hl-stack hl-stack--tight" style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {p.readiness.map((check) => (
              <li key={check.key} className={check.ok ? undefined : "hl-muted"}>
                {check.ok ? "✓" : "○"} {check.label}
                {check.detail ? ` — ${check.detail}` : ""}
              </li>
            ))}
          </ul>

          <div className="hl-row">
            <Link href={`/dashboard/${detail.slug}/log?phase=${p.phase}`} className="hl-btn">
              Log work
            </Link>
            {p.canSubmit ? (
              <Link
                href={`/dashboard/${detail.slug}/submit/${p.phase.toLowerCase()}`}
                className="hl-btn hl-btn--primary"
              >
                Submit {p.label.toLowerCase()}
              </Link>
            ) : null}
            {p.status === PhaseStatus.in_review ? (
              <ActionButton
                url={`/api/projects/${detail.project.id}/unsubmit`}
                body={{ phase: p.phase }}
                label="Withdraw"
                confirm="Withdraw this submission from the review queue?"
              />
            ) : null}
          </div>
        </Panel>
      ))}

      <Panel title="Project details">
        <ProjectMetaForm
          projectId={detail.project.id}
          initial={{
            title: detail.project.title,
            description: detail.project.description ?? "",
            githubRepo: detail.project.githubRepo ?? "",
          }}
          disabled={inReview}
        />
      </Panel>

      <Panel title="Hackatime">
        {detail.hackatimeLinks.length > 0 ? (
          <Table head={["Project", "Counts toward", "Hours", ""]}>
            {detail.hackatimeLinks.map((link) => (
              <tr key={link.id}>
                <td className="hl-mono">{link.hackatimeProject}</td>
                <td>{link.phase.toLowerCase()}</td>
                <td>
                  {(link.hoursApproved ?? (link.cachedSeconds ?? 0) / 3600).toFixed(1)}h
                  {link.hoursApproved !== null ? " (reviewed)" : ""}
                </td>
                <td>
                  {link.hoursApproved === null ? (
                    <ActionButton
                      url={`/api/projects/${detail.project.id}/hackatime/${link.id}`}
                      method="DELETE"
                      label="Unlink"
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState>No Hackatime projects linked to this theme yet.</EmptyState>
        )}
        <HackatimeLinkForm projectId={detail.project.id} linked={hackatimeLinked} />
      </Panel>

      <Panel
        title="Work log"
        actions={<Link href={`/dashboard/${detail.slug}/log`}>Log a session</Link>}
      >
        {detail.sessions.length === 0 ? (
          <EmptyState>Nothing logged yet.</EmptyState>
        ) : (
          <Table head={["Date", "Phase", "What", "Hours", ""]}>
            {detail.sessions.map((session) => (
              <tr key={session.id}>
                <td className="hl-mono">{session.effectiveDate ?? "—"}</td>
                <td>{session.phase.toLowerCase()}</td>
                <td>
                  {session.title}
                  {session.media.length > 0 ? (
                    <div className="hl-hint">
                      {session.media.map((m) => (
                        <a
                          key={m.id}
                          href={publicUrlFor(m.objectKey) ?? "#"}
                          style={{ marginRight: "0.5rem" }}
                        >
                          {m.type.toLowerCase()}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {session.reviewComments ? (
                    <div className="hl-hint">Reviewer: {session.reviewComments}</div>
                  ) : null}
                </td>
                <td>
                  {session.hoursApproved ?? session.hoursClaimed}h
                  {session.hoursApproved !== null &&
                  session.hoursApproved !== session.hoursClaimed ? (
                    <span className="hl-hint"> (claimed {session.hoursClaimed}h)</span>
                  ) : null}
                  {session.hoursSource === "HACKATIME_TRACKED" ? (
                    <div className="hl-hint">counted via Hackatime</div>
                  ) : null}
                </td>
                <td>
                  {session.hoursApproved === null ? (
                    <ActionButton
                      url={`/api/projects/${detail.project.id}/sessions/${session.id}`}
                      method="DELETE"
                      label="Delete"
                      confirm="Delete this entry?"
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  )
}
