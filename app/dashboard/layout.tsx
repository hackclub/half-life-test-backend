import Link from "next/link"
import { requireSessionPage } from "@/lib/page-guards"
import { hasAnyPermission, Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

/**
 * The session gate is here, in a server component. Doing it client-side (as
 * stasis does) means an unauthorised page renders first and then disappears.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, roles } = await requireSessionPage()
  const canReview = hasAnyPermission(roles, [Permission.REVIEW_SUBMISSIONS])
  const canAdmin = hasAnyPermission(roles, [
    Permission.VIEW_USERS,
    Permission.MANAGE_SHOP,
    Permission.FULFILL_ORDERS,
    Permission.VIEW_AUDIT_LOG,
    Permission.MANAGE_PROGRAM,
  ])

  return (
    <>
      <nav className="hl-nav">
        <strong>Half-Life</strong>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/shop">Shop</Link>
        {canReview ? <Link href="/review">Review</Link> : null}
        {canAdmin ? <Link href="/admin">Admin</Link> : null}
        <span className="hl-muted" style={{ marginLeft: "auto" }}>
          {user.email}
        </span>
      </nav>
      <main className="hl-shell">{children}</main>
    </>
  )
}
