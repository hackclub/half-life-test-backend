import prisma from "@/lib/prisma"
import { requireSessionPage } from "@/lib/page-guards"
import { getLedgerPage } from "@/lib/currency"
import { CREDIT_NAME_PLURAL } from "@/lib/config/program"
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"

export const dynamic = "force-dynamic"

export default async function OrdersPage() {
  const { user } = await requireSessionPage()
  const [orders, ledger] = await Promise.all([
    prisma.shopOrder.findMany({
      where: { userId: user.id },
      orderBy: { placedAt: "desc" },
      take: 50,
    }),
    getLedgerPage(user.id, undefined, 50),
  ])

  return (
    <div className="hl-stack">
      <PageHeader title="My orders" />

      <Panel title="Orders">
        {orders.length === 0 ? (
          <EmptyState>You have not bought anything yet.</EmptyState>
        ) : (
          <Table head={["#", "Item", "Cost", "Status", "Placed"]}>
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="hl-mono">{order.orderNumber}</td>
                <td>{order.itemNameSnapshot}</td>
                <td>{order.totalCredits}</td>
                <td>
                  <Badge
                    tone={
                      order.status === "FULFILLED"
                        ? "success"
                        : order.status === "REJECTED"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {order.status.toLowerCase()}
                  </Badge>
                  {order.rejectionReason ? (
                    <div className="hl-hint">{order.rejectionReason}</div>
                  ) : null}
                  {order.trackingNumber ? (
                    <div className="hl-hint">
                      {order.trackingCarrier} {order.trackingNumber}
                    </div>
                  ) : null}
                </td>
                <td className="hl-mono">{order.placedAt.toDateString()}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title={`${CREDIT_NAME_PLURAL} history`}>
        {ledger.items.length === 0 ? (
          <EmptyState>Nothing yet. Ship a build to start earning.</EmptyState>
        ) : (
          <Table head={["When", "What", "Amount", "Balance"]}>
            {ledger.items.map((entry) => (
              <tr key={entry.id}>
                <td className="hl-mono">{entry.createdAt.toDateString()}</td>
                <td>
                  {entry.note ?? entry.kind}
                  <div className="hl-hint">{entry.kind.toLowerCase().replace(/_/g, " ")}</div>
                </td>
                <td className="hl-mono">
                  {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                </td>
                <td className="hl-mono">{entry.balanceAfter}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  )
}
