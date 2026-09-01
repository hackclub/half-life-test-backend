import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { Phase, PhaseStatus, ReviewResult, Theme } from "../app/generated/prisma/enums"

/**
 * End-to-end check of the money path.
 *
 * The property that matters: approving a build, un-approving it, and approving
 * it again must land on exactly the same balance as approving it once. That is
 * what `reconcileGrant` buys, and it is the failure mode that costs real money
 * if it regresses.
 *
 * Run with `yarn tsx scripts/verify-ledger.ts` against a scratch database.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
})

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (!pass) failures++
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

async function main() {
  const { finalizeReview, unapprovePhase } = await import("../lib/review")
  const { getBalance } = await import("../lib/currency")
  const { getPrinterQualification } = await import("../lib/printer")
  const { excessCreditFor } = await import("../lib/hours")
  const { THEME_COMPLETION_BONUS } = await import("../lib/config/program")

  const stamp = Date.now()
  const participant = await prisma.user.create({
    data: {
      email: `ledger-check-${stamp}@example.test`,
      name: "Ledger Check",
      verificationStatus: "verified",
    },
  })
  const reviewer = await prisma.user.create({
    data: { email: `reviewer-${stamp}@example.test`, name: "Reviewer" },
  })

  const project = await prisma.themeProject.create({
    data: {
      userId: participant.id,
      theme: Theme.PCB,
      title: "Ledger check board",
      description: "A board for checking the ledger.",
      designStatus: PhaseStatus.approved,
      tier: 1,
      grantUsd: 30,
      buildStatus: PhaseStatus.in_review,
    },
  })

  // 18 hours of journal work against a 10-hour Tier 1 minimum.
  await prisma.workSession.create({
    data: {
      themeProjectId: project.id,
      phase: Phase.BUILD,
      title: "Assembly",
      hoursClaimed: 18,
      effectiveDate: "2026-10-01",
    },
  })

  const expectedExcess = excessCreditFor(1, 18)
  const expectedTotal = expectedExcess + THEME_COMPLETION_BONUS

  async function approve() {
    const submission = await prisma.phaseSubmission.create({
      data: { themeProjectId: project.id, phase: Phase.BUILD },
    })
    await prisma.themeProject.update({
      where: { id: project.id },
      data: { buildStatus: PhaseStatus.in_review },
    })
    return finalizeReview({
      submissionId: submission.id,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      reviewerEmail: reviewer.email,
      result: ReviewResult.APPROVED,
      feedback: "Looks good.",
      reason: "18h of assembly work, evidenced.",
    })
  }

  const balanceStart = await prisma.$transaction((tx) => getBalance(tx, participant.id))
  check("starting balance", balanceStart, 0)

  const first = await approve()
  const afterFirst = await prisma.$transaction((tx) => getBalance(tx, participant.id))
  check("approved hours frozen", first.approvedHours, 18)
  check("excess credit", first.excessCredit, expectedExcess)
  check("balance after first approval", afterFirst, expectedTotal)

  await unapprovePhase(project.id, Phase.BUILD, reviewer.id, reviewer.email, "checking reversal")
  const afterUnapprove = await prisma.$transaction((tx) => getBalance(tx, participant.id))
  check("balance after un-approval returns to zero", afterUnapprove, 0)

  await approve()
  const afterSecond = await prisma.$transaction((tx) => getBalance(tx, participant.id))
  check("balance after re-approval does not double", afterSecond, expectedTotal)

  const entries = await prisma.ledgerEntry.count({ where: { userId: participant.id } })
  // Two credits, two reversals, two credits again: history is appended, never
  // edited, and the running total still converges.
  check("ledger rows appended, never edited", entries, 6)

  // Approving the remaining four themes should mint the printer award.
  const others = [Theme.CAD, Theme.SYNTH, Theme.DISPLAYS, Theme.BREADBOARD_COMPUTER]
  for (const theme of others) {
    await prisma.themeProject.create({
      data: {
        userId: participant.id,
        theme,
        title: `${theme} check`,
        designStatus: PhaseStatus.approved,
        buildStatus: PhaseStatus.approved,
        tier: 1,
        grantUsd: 30,
      },
    })
  }
  const qualification = await getPrinterQualification(participant.id)
  check("printer qualification", qualification.qualified, true)
  check("themes shipped", qualification.shippedCount, 5)

  // Clean up so the script is re-runnable. Order matters: SubmissionReview
  // restricts deleting its reviewer, so the participant (whose projects cascade
  // down to those reviews) has to go first.
  await prisma.user.delete({ where: { id: participant.id } })
  await prisma.user.delete({ where: { id: reviewer.id } })

  console.log(failures === 0 ? "\nAll ledger checks passed." : `\n${failures} check(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
