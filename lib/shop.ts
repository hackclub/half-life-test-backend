import "server-only"
import prisma from "@/lib/prisma"
import { LedgerKind, ShopOrderStatus } from "@/app/generated/prisma/enums"
import type { ShopItem, ShopOrder } from "@/app/generated/prisma/client"
import { HttpError } from "@/lib/errors"
import { appendLedgerEntry, getBalance, lockUserCredit } from "@/lib/currency"
import { getPrinterQualification } from "@/lib/printer"
import { getShopAccess, SHOP_CLOSED_MESSAGE } from "@/lib/program"

export interface ShopItemView extends ShopItem {
  affordable: boolean
  locked: boolean
  lockReason: string | null
  ownedCount: number
}

export async function getShopItemsFor(userId: string): Promise<{
  items: ShopItemView[]
  balance: number
}> {
  const [items, balance, qualification, orders] = await Promise.all([
    prisma.shopItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.$transaction((tx) => getBalance(tx, userId)),
    getPrinterQualification(userId),
    prisma.shopOrder.groupBy({
      by: ["shopItemId"],
      where: { userId, status: { notIn: [ShopOrderStatus.REJECTED, ShopOrderStatus.CANCELLED] } },
      _sum: { quantity: true },
    }),
  ])

  const owned = new Map(orders.map((o) => [o.shopItemId, o._sum.quantity ?? 0]))

  return {
    balance,
    items: items.map((item) => {
      const ownedCount = owned.get(item.id) ?? 0
      let locked = false
      let lockReason: string | null = null

      if (item.requiresPrinterQualified && !qualification.qualified) {
        locked = true
        lockReason = `Ship all ${qualification.required} themes to unlock (${qualification.shippedCount} so far)`
      } else if (item.maxPerUser > 0 && ownedCount >= item.maxPerUser) {
        locked = true
        lockReason = "You already have this"
      } else if (item.stock !== null && item.stock <= 0) {
        locked = true
        lockReason = "Out of stock"
      }

      return { ...item, ownedCount, affordable: balance >= item.priceCredits, locked, lockReason }
    }),
  }
}

/**
 * Buy something.
 *
 * The whole thing runs under a per-user advisory lock. The ledger's
 * `@@unique([shopOrderId, kind])` only stops one order being charged twice —
 * two concurrent purchases mint two different order ids and collide with
 * nothing, so without the lock ten parallel requests all read the same balance
 * and all succeed.
 */
export async function purchase(
  userId: string,
  shopItemId: string,
  quantity: number,
): Promise<ShopOrder> {
  const access = await getShopAccess(userId)
  if (!access.open) throw new HttpError("SHOP_CLOSED", SHOP_CLOSED_MESSAGE)

  const item = await prisma.shopItem.findUnique({ where: { id: shopItemId } })
  if (!item || !item.active) throw new HttpError("NOT_FOUND", "Item not found")

  if (item.requiresPrinterQualified) {
    const qualification = await getPrinterQualification(userId)
    if (!qualification.qualified) {
      throw new HttpError(
        "ITEM_LOCKED",
        `Ship all ${qualification.required} themes to unlock this`,
      )
    }
  }

  return prisma.$transaction(async (tx) => {
    await lockUserCredit(tx, userId)

    // Re-read stock inside the transaction; the catalogue page may be stale.
    const fresh = await tx.shopItem.findUnique({ where: { id: shopItemId } })
    if (!fresh || !fresh.active) throw new HttpError("NOT_FOUND", "Item not found")
    if (fresh.stock !== null && fresh.stock < quantity) {
      throw new HttpError("OUT_OF_STOCK", "Not enough stock left")
    }

    if (fresh.maxPerUser > 0) {
      const owned = await tx.shopOrder.aggregate({
        where: {
          userId,
          shopItemId,
          status: { notIn: [ShopOrderStatus.REJECTED, ShopOrderStatus.CANCELLED] },
        },
        _sum: { quantity: true },
      })
      if ((owned._sum.quantity ?? 0) + quantity > fresh.maxPerUser) {
        throw new HttpError("PURCHASE_LIMIT", `Limit ${fresh.maxPerUser} per person`)
      }
    }

    const totalCredits = fresh.priceCredits * quantity
    const balance = await getBalance(tx, userId)
    if (balance < totalCredits) {
      throw new HttpError(
        "INSUFFICIENT_CREDIT",
        `You need ${totalCredits - balance} more to buy this`,
      )
    }

    const order = await tx.shopOrder.create({
      data: {
        userId,
        shopItemId,
        quantity,
        unitCredits: fresh.priceCredits,
        totalCredits,
        itemNameSnapshot: fresh.name,
      },
    })

    await appendLedgerEntry(tx, {
      userId,
      kind: LedgerKind.SHOP_PURCHASE,
      amount: -totalCredits,
      note: `${quantity}× ${fresh.name}`,
      shopOrderId: order.id,
      createdById: userId,
    })

    if (fresh.stock !== null) {
      // Conditional, so stock cannot go negative even if two people buy the
      // last unit at once — the loser's update matches nothing and rolls back.
      const claimed = await tx.shopItem.updateMany({
        where: { id: shopItemId, stock: { gte: quantity } },
        data: { stock: { decrement: quantity } },
      })
      if (claimed.count !== 1) throw new HttpError("OUT_OF_STOCK", "Not enough stock left")
    }

    return order
  })
}

/**
 * Reject an order and refund it.
 *
 * The refund is a new positive row, never an edit to the original debit: the
 * ledger is append-only, and the history of a rejected order is part of the
 * record.
 */
export async function rejectOrder(
  orderId: string,
  adminId: string,
  reason: string,
): Promise<ShopOrder> {
  const target = await prisma.shopOrder.findUnique({
    where: { id: orderId },
    select: { userId: true },
  })
  if (!target) throw new HttpError("NOT_FOUND", "Order not found")

  return prisma.$transaction(async (tx) => {
    await lockUserCredit(tx, target.userId)

    const order = await tx.shopOrder.findUnique({ where: { id: orderId } })
    if (!order) throw new HttpError("NOT_FOUND", "Order not found")
    if (order.status !== ShopOrderStatus.PENDING && order.status !== ShopOrderStatus.ON_HOLD) {
      throw new HttpError("CONFLICT", "This order has already been decided")
    }

    await appendLedgerEntry(tx, {
      userId: order.userId,
      kind: LedgerKind.SHOP_REFUND,
      amount: order.totalCredits,
      note: `Refund for order #${order.orderNumber}: ${reason}`,
      shopOrderId: order.id,
      createdById: adminId,
    })

    if (order.shopItemId) {
      await tx.shopItem.updateMany({
        where: { id: order.shopItemId, stock: { not: null } },
        data: { stock: { increment: order.quantity } },
      })
    }

    return tx.shopOrder.update({
      where: { id: orderId },
      data: {
        status: ShopOrderStatus.REJECTED,
        rejectionReason: reason,
        rejectedAt: new Date(),
        lastActorId: adminId,
      },
    })
  })
}

export async function fulfillOrder(
  orderId: string,
  adminId: string,
  tracking: { number?: string | null; carrier?: string | null },
): Promise<ShopOrder> {
  const order = await prisma.shopOrder.findUnique({ where: { id: orderId } })
  if (!order) throw new HttpError("NOT_FOUND", "Order not found")
  if (order.status === ShopOrderStatus.FULFILLED) {
    throw new HttpError("CONFLICT", "This order is already fulfilled")
  }
  if (order.status === ShopOrderStatus.REJECTED) {
    throw new HttpError("CONFLICT", "This order was rejected")
  }

  return prisma.shopOrder.update({
    where: { id: orderId },
    data: {
      status: ShopOrderStatus.FULFILLED,
      fulfilledAt: new Date(),
      trackingNumber: tracking.number ?? null,
      trackingCarrier: tracking.carrier ?? null,
      lastActorId: adminId,
    },
  })
}
