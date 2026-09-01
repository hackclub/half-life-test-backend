import prisma from "@/lib/prisma"
import type { NextRequest } from "next/server"
import { ok, parseQuery, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { getBalance, getEarnedCredit, getLedgerPage } from "@/lib/currency"

export const dynamic = "force-dynamic"

export const GET = withRoute(async (req: NextRequest) => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  const query = parseQuery(req, paginationQuery)
  if (query.error) return query.error

  const [balance, earned, page] = await Promise.all([
    prisma.$transaction((tx) => getBalance(tx, gate.user.id)),
    prisma.$transaction((tx) => getEarnedCredit(tx, gate.user.id)),
    getLedgerPage(gate.user.id, query.data.cursor, query.data.limit),
  ])

  return ok({ balance, earned, items: page.items, nextCursor: page.nextCursor })
})
