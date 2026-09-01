import "server-only"
import prisma from "@/lib/prisma"
import { LedgerKind } from "@/app/generated/prisma/enums"
import type { LedgerEntry, Prisma } from "@/app/generated/prisma/client"

type Tx = Prisma.TransactionClient

/** Kinds that represent earning, as opposed to spending. */
const EARNING_KINDS: LedgerKind[] = [
  LedgerKind.EXCESS_HOURS,
  LedgerKind.THEME_COMPLETION_BONUS,
  LedgerKind.ADMIN_ADJUSTMENT,
  LedgerKind.REVIEWER_PAYMENT,
]

async function sumFor(tx: Tx, where: Prisma.LedgerEntryWhereInput): Promise<number> {
  const { _sum } = await tx.ledgerEntry.aggregate({ where, _sum: { amount: true } })
  return _sum.amount ?? 0
}

/** Authoritative balance. Always SUM(amount) — there is no balance column. */
export async function getBalance(tx: Tx, userId: string): Promise<number> {
  return sumFor(tx, { userId })
}

/** Lifetime earnings, ignoring spending. For progress displays. */
export async function getEarnedCredit(tx: Tx, userId: string): Promise<number> {
  return sumFor(tx, { userId, kind: { in: EARNING_KINDS } })
}

export interface LedgerEntryParams {
  userId: string
  kind: LedgerKind
  amount: number
  note?: string | null
  themeProjectId?: string | null
  shopOrderId?: string | null
  createdById?: string | null
}

/**
 * Append one ledger row.
 *
 * MUST be called inside `prisma.$transaction` so the balance aggregate and the
 * insert cannot interleave with a concurrent write and record a
 * balanceBefore/balanceAfter pair that was never true.
 */
export async function appendLedgerEntry(
  tx: Tx,
  params: LedgerEntryParams,
): Promise<LedgerEntry> {
  const balanceBefore = await getBalance(tx, params.userId)
  return tx.ledgerEntry.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      amount: params.amount,
      note: params.note ?? null,
      themeProjectId: params.themeProjectId ?? null,
      shopOrderId: params.shopOrderId ?? null,
      createdById: params.createdById ?? null,
      balanceBefore,
      balanceAfter: balanceBefore + params.amount,
    },
  })
}

export interface ReconcileParams {
  userId: string
  themeProjectId: string
  kind: LedgerKind
  /** What the total for this (user, project, kind) should now be. */
  target: number
  note: string
  createdById?: string | null
}

/**
 * Append a single delta row so that SUM(amount) over
 * (userId, themeProjectId, kind) equals `target`. Returns null when nothing
 * needed to change.
 *
 * This is what makes re-review idempotent: approving the same project five
 * times converges on one balance instead of compounding, and un-approving is
 * the same call with `target: 0` rather than a separate reversal code path —
 * so there is no separate reversal code path to get wrong.
 *
 * Stasis instead pairs every kind with a *_REVERSED twin and cancels by hand,
 * which means every aggregate over the ledger has to remember to include the
 * twin. Its lib/currency.ts carries a long comment about the query that
 * forgot and overcounted forever.
 *
 * Must run inside a transaction, for the same reason as appendLedgerEntry.
 */
export async function reconcileGrant(
  tx: Tx,
  params: ReconcileParams,
): Promise<LedgerEntry | null> {
  const current = await sumFor(tx, {
    userId: params.userId,
    themeProjectId: params.themeProjectId,
    kind: params.kind,
  })
  const delta = params.target - current
  if (delta === 0) return null

  return appendLedgerEntry(tx, {
    userId: params.userId,
    kind: params.kind,
    amount: delta,
    note: params.note,
    themeProjectId: params.themeProjectId,
    createdById: params.createdById ?? null,
  })
}

export async function getLedgerPage(
  userId: string,
  cursor: string | undefined,
  limit: number,
): Promise<{ items: LedgerEntry[]; nextCursor: string | null }> {
  const rows = await prisma.ledgerEntry.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  return { items, nextCursor: hasMore && last ? last.id : null }
}

export { LedgerKind }
