import Link from "next/link"
import type { ReactNode } from "react"

/**
 * Presentational primitives. These are the only files besides globals.css that
 * know about colour, spacing or type — a page composes these and never writes a
 * raw utility class.
 */

type Variant = "default" | "primary" | "danger"

const variantClass: Record<Variant, string> = {
  default: "hl-btn",
  primary: "hl-btn hl-btn--primary",
  danger: "hl-btn hl-btn--danger",
}

export function Button({
  variant = "default",
  className,
  ...props
}: Readonly<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>) {
  return <button {...props} className={`${variantClass[variant]} ${className ?? ""}`} />
}

export function LinkButton({
  href,
  variant = "default",
  children,
}: Readonly<{ href: string; variant?: Variant; children: ReactNode }>) {
  return (
    <Link href={href} className={variantClass[variant]}>
      {children}
    </Link>
  )
}

export function Panel({
  title,
  actions,
  children,
}: Readonly<{ title?: ReactNode; actions?: ReactNode; children: ReactNode }>) {
  return (
    <section className="hl-panel hl-stack hl-stack--tight">
      {(title || actions) && (
        <div className="hl-row" style={{ justifyContent: "space-between" }}>
          {title ? <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: Readonly<{ title: string; subtitle?: ReactNode; actions?: ReactNode }>) {
  return (
    <header className="hl-stack hl-stack--tight" style={{ marginBottom: "1.5rem" }}>
      <div className="hl-row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: "1.4rem" }}>{title}</h1>
        {actions}
      </div>
      {subtitle ? <p className="hl-muted" style={{ margin: 0 }}>{subtitle}</p> : null}
    </header>
  )
}

type BadgeTone = "success" | "warning" | "danger" | "muted"

export function Badge({ tone = "muted", children }: Readonly<{ tone?: BadgeTone; children: ReactNode }>) {
  return <span className={`hl-badge hl-badge--${tone}`}>{children}</span>
}

export function Callout({
  tone,
  children,
}: Readonly<{ tone?: "danger" | "warning"; children: ReactNode }>) {
  return <div className={`hl-callout ${tone ? `hl-callout--${tone}` : ""}`}>{children}</div>
}

export function Stat({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div className="hl-stat">
      <div className="hl-stat-value">{value}</div>
      <div className="hl-stat-label">{label}</div>
    </div>
  )
}

export function EmptyState({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p className="hl-muted" style={{ margin: 0 }}>
      {children}
    </p>
  )
}

export function Field({
  label,
  hint,
  children,
}: Readonly<{ label: string; hint?: ReactNode; children: ReactNode }>) {
  return (
    <label className="hl-stack hl-stack--tight" style={{ gap: "0.25rem" }}>
      <span className="hl-label">{label}</span>
      {children}
      {hint ? <span className="hl-hint">{hint}</span> : null}
    </label>
  )
}

export function Table({ head, children }: Readonly<{ head: ReactNode[]; children: ReactNode }>) {
  return (
    <div className="hl-scroll">
      <table className="hl-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** Status → tone, in one place so every surface agrees. */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "approved":
      return "success"
    case "in_review":
      return "warning"
    case "rejected":
      return "danger"
    case "update_requested":
      return "warning"
    default:
      return "muted"
  }
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ")
}
