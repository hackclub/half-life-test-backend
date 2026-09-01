import prisma from "@/lib/prisma"
import { ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { permissionsFor } from "@/lib/permissions"
import { getBalance, getEarnedCredit } from "@/lib/currency"
import { getPrinterQualification } from "@/lib/printer"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  const [user, balance, earned, printer] = await Promise.all([
    prisma.user.findUnique({
      where: { id: gate.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        slackId: true,
        verificationStatus: true,
        hackatimeUserId: true,
        fraudFlagged: true,
        submissionExtensionUntil: true,
      },
    }),
    prisma.$transaction((tx) => getBalance(tx, gate.user.id)),
    prisma.$transaction((tx) => getEarnedCredit(tx, gate.user.id)),
    getPrinterQualification(gate.user.id),
  ])

  return ok({
    user: { ...user, hackatimeLinked: !!user?.hackatimeUserId },
    roles: gate.roles,
    permissions: permissionsFor(gate.roles),
    credit: { balance, earned },
    printer,
  })
})
