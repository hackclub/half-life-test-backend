/**
 * Funding tiers.
 *
 * A tier is assigned per themed project when its DESIGN phase is approved. The
 * tier's dollars are parts money, so the decision has to land before the build
 * starts, not after it.
 *
 * `minHours` is the hours the grant buys. Approved hours BEYOND it convert to
 * shop credit at `CREDIT_PER_EXCESS_HOUR` (see ./program.ts).
 */
export interface Tier {
  readonly id: 1 | 2 | 3
  readonly name: string
  /** Grant paid through the YSWS pipeline, in whole USD. */
  readonly grantUsd: number
  /** Hours the grant covers. Excess above this mints credit. */
  readonly minHours: number
  readonly blurb: string
  readonly examples: readonly string[]
}

// ⚠️ Only Tier 1 ($30 / 10h) is confirmed by the program designer. Tier 2 and
// Tier 3 are PLACEHOLDERS. Changing them is this file and nothing else —
// every review freezes the numbers it actually used onto SubmissionReview, so
// editing these does not rewrite anyone's history.
export const TIERS = [
  {
    id: 1,
    name: "Tier 1",
    grantUsd: 30,
    minHours: 10,
    blurb: "A focused build you can finish over a couple of weekends.",
    examples: ["Simple 2-layer breakout board", "Single-part printed enclosure"],
  },
  {
    id: 2,
    name: "Tier 2",
    grantUsd: 75, // PLACEHOLDER
    minHours: 20, // PLACEHOLDER
    blurb: "A multi-part build with real integration work.",
    examples: ["4-layer board with an MCU", "Multi-part mechanism"],
  },
  {
    id: 3,
    name: "Tier 3",
    grantUsd: 150, // PLACEHOLDER
    minHours: 35, // PLACEHOLDER
    blurb: "An ambitious build with novel engineering.",
    examples: ["Polyphonic synth voice card", "Full breadboard CPU"],
  },
] as const satisfies readonly Tier[]

export type TierId = (typeof TIERS)[number]["id"]

export const TIER_IDS: readonly TierId[] = TIERS.map((t) => t.id)

export function getTier(id: number): Tier | undefined {
  return TIERS.find((t) => t.id === id)
}

export function getTierOrThrow(id: number): Tier {
  const tier = getTier(id)
  if (!tier) throw new Error(`Unknown tier: ${id}`)
  return tier
}

export function isTierId(id: unknown): id is TierId {
  return typeof id === "number" && TIER_IDS.includes(id as TierId)
}

/** The tier an hour count falls into, for suggesting a default to a reviewer. */
export function suggestTierForHours(hours: number): TierId {
  let suggested: TierId = TIERS[0].id
  for (const tier of TIERS) {
    if (hours >= tier.minHours) suggested = tier.id
  }
  return suggested
}

/** Airtable's `Complexity Tier` single-select label. */
export function tierAirtableLabel(id: number): string {
  const tier = getTier(id)
  return tier ? `Complexity ${tier.name}` : ""
}
