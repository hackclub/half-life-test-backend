import Link from "next/link"
import { requireSessionPage } from "@/lib/page-guards"
import { getShopItemsFor } from "@/lib/shop"
import { getShopAccess } from "@/lib/program"
import { CREDIT_NAME_PLURAL } from "@/lib/config/program"
import { Badge, Callout, EmptyState, PageHeader, Panel, Stat } from "@/app/components/ui"
import { ActionButton } from "@/app/components/forms/ActionButton"

export const dynamic = "force-dynamic"

export default async function ShopPage() {
  const { user } = await requireSessionPage()
  const [{ items, balance }, access] = await Promise.all([
    getShopItemsFor(user.id),
    getShopAccess(user.id),
  ])

  return (
    <div className="hl-stack">
      <PageHeader
        title="Shop"
        subtitle={`Upgrades for the 3D printer you earn by shipping all five themes.`}
        actions={<Link href="/shop/orders">My orders</Link>}
      />

      <div className="hl-row">
        <Stat label={`${CREDIT_NAME_PLURAL} available`} value={balance} />
      </div>

      {!access.open ? (
        <Callout tone="warning">
          The shop is closed
          {access.reason === "CLOSED" && access.closesAt
            ? ` (closed ${access.closesAt.toDateString()})`
            : ""}
          .
        </Callout>
      ) : access.reason === "GRACE_PERIOD" ? (
        <Callout>
          The shop is closed for everyone else. You have until{" "}
          {access.graceUntil?.toDateString()} because of a recent review.
        </Callout>
      ) : null}

      {items.length === 0 ? (
        <EmptyState>Nothing in the shop yet.</EmptyState>
      ) : (
        <div className="hl-grid">
          {items.map((item) => (
            <Panel
              key={item.id}
              title={item.name}
              actions={
                <Badge tone={item.locked ? "muted" : item.affordable ? "success" : "warning"}>
                  {item.priceCredits}
                </Badge>
              }
            >
              <p className="hl-muted" style={{ margin: 0 }}>
                {item.description}
              </p>
              {item.lockReason ? <p className="hl-hint">{item.lockReason}</p> : null}
              {item.stock !== null ? (
                <p className="hl-hint">{item.stock} left</p>
              ) : null}
              <ActionButton
                url="/api/shop/orders"
                body={{ shopItemId: item.id, quantity: 1 }}
                label="Buy"
                variant="primary"
                disabled={item.locked || !item.affordable || !access.open}
                confirm={`Spend ${item.priceCredits} ${CREDIT_NAME_PLURAL} on ${item.name}?`}
              />
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}
