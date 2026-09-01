import "server-only"
import prisma from "@/lib/prisma"
import { ShopOrderStatus } from "@/app/generated/prisma/enums"
import { getBalance } from "@/lib/currency"
import { getPrinterQualification } from "@/lib/printer"

export async function listUsers(opts: { q?: string; cursor?: string; limit: number }) {
  const rows = await prisma.user.findMany({
    where: opts.q
      ? {
          OR: [
            { email: { contains: opts.q, mode: "insensitive" } },
            { name: { contains: opts.q, mode: "insensitive" } },
            { slackId: { contains: opts.q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      email: true,
      slackId: true,
      verificationStatus: true,
      fraudFlagged: true,
      createdAt: true,
      roles: { select: { role: true } },
    },
  })
  const hasMore = rows.length > opts.limit
  const items = hasMore ? rows.slice(0, opts.limit) : rows
  const last = items[items.length - 1]
  return { items, nextCursor: hasMore && last ? last.id : null }
}

export async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      slackId: true,
      slackDisplayName: true,
      verificationStatus: true,
      hackatimeUserId: true,
      fraudFlagged: true,
      submissionExtensionUntil: true,
      createdAt: true,
      joinedProgramAt: true,
      roles: { select: { role: true, grantedAt: true, grantedBy: true } },
      themeProjects: {
        where: { deletedAt: null },
        select: {
          id: true,
          theme: true,
          title: true,
          designStatus: true,
          buildStatus: true,
          tier: true,
          grantUsd: true,
          approvedHours: true,
          excessCredit: true,
        },
      },
      printerAward: true,
    },
  })
  if (!user) return null

  const [balance, ledger, orders, printer] = await Promise.all([
    prisma.$transaction((tx) => getBalance(tx, userId)),
    prisma.ledgerEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
    prisma.shopOrder.findMany({
      where: { userId },
      orderBy: { placedAt: "desc" },
      take: 25,
    }),
    getPrinterQualification(userId),
  ])

  return { user, balance, ledger, orders, printer }
}

export async function listOrders(opts: {
  status?: ShopOrderStatus
  cursor?: string
  limit: number
}) {
  const rows = await prisma.shopOrder.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      user: { select: { id: true, name: true, email: true } },
      shopItem: { select: { id: true, name: true } },
    },
  })
  const hasMore = rows.length > opts.limit
  const items = hasMore ? rows.slice(0, opts.limit) : rows
  const last = items[items.length - 1]
  return { items, nextCursor: hasMore && last ? last.id : null }
}

export async function listAuditLog(opts: {
  action?: string
  targetId?: string
  cursor?: string
  limit: number
}) {
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(opts.action ? { action: opts.action as never } : {}),
      ...(opts.targetId ? { targetId: opts.targetId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  })
  const hasMore = rows.length > opts.limit
  const items = hasMore ? rows.slice(0, opts.limit) : rows
  const last = items[items.length - 1]
  return { items, nextCursor: hasMore && last ? last.id : null }
}

export async function getAdminCounters() {
  const [pendingReviews, pendingOrders, participants, shipped] = await Promise.all([
    prisma.phaseSubmission.count({ where: { resolvedAt: null } }),
    prisma.shopOrder.count({ where: { status: ShopOrderStatus.PENDING } }),
    prisma.user.count(),
    prisma.printerAward.count({ where: { revokedAt: null } }),
  ])
  return { pendingReviews, pendingOrders, participants, shipped }
}
