import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"

// Orchard's healthcheck and the container's HEALTHCHECK both point here.
// Touching Postgres means a pod with a dead database is marked unhealthy
// instead of serving errors for every request.
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[health] database check failed:", err)
    return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 })
  }
}
