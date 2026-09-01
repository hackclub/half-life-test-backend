import Link from "next/link"
import { requireSessionPage } from "@/lib/page-guards"
import { getDashboard } from "@/lib/queries/dashboard"
import { CREDIT_NAME_PLURAL, TOTAL_WEEKS } from "@/lib/config/program"
import { Badge, Callout, Panel, PageHeader, Stat, statusLabel, statusTone } from "@/app/components/ui"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const { user } = await requireSessionPage()
  const data = await getDashboard(user.id)

  return (
    <div className="hl-stack">
      <PageHeader
        title={`Week ${data.currentWeek || "—"} of ${TOTAL_WEEKS}`}
        subtitle={
          data.focus
            ? `This week: ${data.focus.themeLabel} — ${data.focus.phase.toLowerCase()}`
            : data.currentWeek === 0
              ? "The program has not started yet."
              : "Outside the scheduled weeks. You can still work on anything."
        }
      />

      <div className="hl-row">
        <Stat label={`${CREDIT_NAME_PLURAL} available`} value={data.balance} />
        <Stat label={`${CREDIT_NAME_PLURAL} earned`} value={data.earned} />
        <Stat
          label="Themes shipped"
          value={`${data.printer.shippedCount} / ${data.printer.required}`}
        />
      </div>

      {data.printer.qualified ? (
        <Callout>
          You have shipped all {data.printer.required} themes. The 3D printer is yours — spend
          your {CREDIT_NAME_PLURAL} on upgrades in the <Link href="/shop">shop</Link>.
        </Callout>
      ) : null}

      <div className="hl-grid">
        {data.cards.map((card) => (
          <Panel
            key={card.id}
            title={<Link href={`/dashboard/${card.slug}`}>{card.label}</Link>}
            actions={card.tier ? <Badge tone="success">Tier {card.tier}</Badge> : null}
          >
            <p className="hl-muted" style={{ margin: 0 }}>
              {card.title || card.blurb}
            </p>
            <div className="hl-row hl-mono" style={{ gap: "0.5rem" }}>
              <span>
                Design (wk {card.designWeek}){" "}
                <Badge tone={statusTone(card.designStatus)}>
                  {statusLabel(card.designStatus)}
                </Badge>
              </span>
            </div>
            <div className="hl-row hl-mono" style={{ gap: "0.5rem" }}>
              <span>
                Build (wk {card.buildWeek}){" "}
                <Badge tone={statusTone(card.buildStatus)}>{statusLabel(card.buildStatus)}</Badge>
              </span>
            </div>
            <p className="hl-hint" style={{ margin: 0 }}>
              {card.designHours}h design · {card.buildHours}h build
              {card.grantUsd !== null ? ` · $${card.grantUsd} granted` : ""}
            </p>
          </Panel>
        ))}
      </div>
    </div>
  )
}
