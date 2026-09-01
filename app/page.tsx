import Link from "next/link"
import { THEMES, TOTAL_WEEKS, CREDIT_NAME_PLURAL } from "@/lib/config/program"
import { TIERS } from "@/lib/config/tiers"
import { Panel } from "@/app/components/ui"

export default function LandingPage() {
  return (
    <main className="hl-shell hl-stack">
      <header className="hl-stack hl-stack--tight">
        <h1 style={{ margin: 0 }}>Half-Life</h1>
        <p className="hl-muted" style={{ margin: 0 }}>
          A {TOTAL_WEEKS}-week hardware program from Hack Club. Five themes, designed in the
          first five weeks and built in the second five.
        </p>
        <p>
          <Link href="/login" className="hl-btn hl-btn--primary">
            Sign in with Hack Club
          </Link>
        </p>
      </header>

      <Panel title="The five themes">
        <ol className="hl-stack hl-stack--tight" style={{ paddingLeft: "1.2rem", margin: 0 }}>
          {THEMES.map((theme) => (
            <li key={theme.slug}>
              <strong>{theme.label}</strong> — {theme.blurb}{" "}
              <span className="hl-muted">
                (design week {theme.designWeek}, build week {theme.buildWeek})
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Funding">
        <p style={{ marginTop: 0 }}>
          Each themed project is reviewed and assigned a tier when its design is approved. The
          tier is your parts budget. Hours you log beyond the tier minimum become{" "}
          {CREDIT_NAME_PLURAL}, which buy upgrades for the 3D printer you earn by shipping all
          five themes.
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {TIERS.map((tier) => (
            <li key={tier.id}>
              <strong>{tier.name}</strong> — ${tier.grantUsd} for {tier.minHours} hours.{" "}
              <span className="hl-muted">{tier.blurb}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  )
}
