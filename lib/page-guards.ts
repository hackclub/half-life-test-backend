import "server-only"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getUserRoles, hasPermission, hasAnyPermission, Permission, Role } from "@/lib/permissions"
import type { SessionUser } from "@/lib/guards"

export interface PageContext {
  user: SessionUser
  roles: Role[]
}

/**
 * Page-level guards live apart from the route-handler ones because they fail
 * differently: a page redirects or 404s, a handler returns JSON. Doing this in
 * a server component (rather than a `'use client'` layout that fetches roles)
 * is what removes the auth flash and stops an unauthorised page from rendering
 * at all.
 */
export async function requireSessionPage(): Promise<PageContext> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")
  const u = session.user
  return {
    user: { id: u.id, email: u.email, name: u.name ?? null, image: u.image ?? null },
    roles: await getUserRoles(u.id),
  }
}

/**
 * 404 rather than 403: don't confirm that /admin exists to someone guessing
 * at URLs.
 */
export async function requirePermissionPage(permission: Permission): Promise<PageContext> {
  const ctx = await requireSessionPage()
  if (!hasPermission(ctx.roles, permission)) notFound()
  return ctx
}

export async function requireAnyPermissionPage(
  ...permissions: Permission[]
): Promise<PageContext> {
  const ctx = await requireSessionPage()
  if (!hasAnyPermission(ctx.roles, permissions)) notFound()
  return ctx
}
