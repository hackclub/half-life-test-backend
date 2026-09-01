/**
 * Typed Airtable schema.
 *
 * Two things are true at once, which is why every field carries both an id and
 * a name:
 *
 *  - Reads and writes use field IDs, which survive an ops person renaming a
 *    column. Siege does this and says why: "robust to column renames". Stasis
 *    writes by name, so a rename silently 422s inside a fire-and-forget side
 *    effect and nobody notices until payout.
 *  - filterByFormula can only reference fields by NAME, so the name has to be
 *    here too. `formulaRef()` is the only sanctioned way to build one.
 *
 * The `fld…` ids are filled in once, from
 * `GET https://api.airtable.com/v0/meta/bases/{baseId}/tables`, by running
 * `yarn tsx scripts/dump-airtable-schema.ts` against the created base.
 * Until then the writer falls back to names — see FIELD_MODE below.
 */

export interface FieldDef<T = unknown> {
  readonly id: string
  readonly name: string
  readonly __type?: T
}

const f = <T,>(id: string, name: string): FieldDef<T> => ({ id, name })

/**
 * Writing by id requires the ids to actually be filled in. Until someone runs
 * the schema dump against the real base, fall back to names so the integration
 * works out of the box rather than 422-ing on every field.
 */
export const FIELD_MODE: "id" | "name" =
  process.env.AIRTABLE_USE_FIELD_IDS === "true" ? "id" : "name"

export function fieldKey(field: FieldDef): string {
  return FIELD_MODE === "id" ? field.id : field.name
}

/** filterByFormula cannot use field ids. */
export function formulaRef(field: FieldDef): string {
  return `{${field.name}}`
}

/**
 * The `YSWS Project Submission` table.
 *
 * The names below are NOT ours to choose. Hack Club's payout pipeline reads
 * them, and they are copied verbatim from stasis's submitYSWSProjectSubmission
 * (lib/airtable.ts). A typo here means someone does not get paid.
 */
export const YSWS_SUBMISSION = {
  tableId: process.env.AIRTABLE_YSWS_TABLE_ID ?? "YSWS Project Submission",
  fields: {
    firstName: f<string>("fldYswsFirstName", "First Name"),
    lastName: f<string>("fldYswsLastName", "Last Name"),
    email: f<string>("fldYswsEmail", "Email"),
    codeUrl: f<string>("fldYswsCodeUrl", "Code URL"),
    playableUrl: f<string>("fldYswsPlayableUrl", "Playable URL"),
    description: f<string>("fldYswsDescription", "Description"),
    screenshot: f<{ url: string }[]>("fldYswsScreenshot", "Screenshot"),
    addressLine1: f<string>("fldYswsAddress1", "Address (Line 1)"),
    addressLine2: f<string>("fldYswsAddress2", "Address (Line 2)"),
    city: f<string>("fldYswsCity", "City"),
    state: f<string>("fldYswsState", "State / Province"),
    country: f<string>("fldYswsCountry", "Country"),
    zip: f<string>("fldYswsZip", "ZIP / Postal Code"),
    birthday: f<string>("fldYswsBirthday", "Birthday"),
    overrideHours: f<number>("fldYswsOverrideHours", "Optional - Override Hours Spent"),
    overrideHoursReason: f<string>(
      "fldYswsOverrideHoursReason",
      "Optional - Override Hours Spent Justification",
    ),
    grantAmount: f<number>("fldYswsGrantAmount", "Requested Grant Amount"),
    complexityTier: f<string>("fldYswsComplexityTier", "Complexity Tier"),
    slackId: f<string>("fldYswsSlackId", "Slack ID"),
    // Written by the pipeline's automation, read by us: it is the only safe way
    // to remove the matching row in the unified base, because Code URL is not
    // unique across programs and all five of a participant's themed projects
    // may share one monorepo URL.
    unifiedRecordId: f<string>("fldYswsUnifiedRecordId", "Automation - YSWS Record ID"),

    // Program-local fields. The pipeline ignores these.
    halfLifeId: f<string>("fldHalfLifeId", "Half-Life ID"),
    stage: f<"Design" | "Build">("fldHalfLifeStage", "Stage"),
    theme: f<string>("fldHalfLifeTheme", "Theme"),
    weekSubmitted: f<number>("fldHalfLifeWeek", "Week Submitted"),
    onTime: f<boolean>("fldHalfLifeOnTime", "On Time"),
    approvedAt: f<string>("fldHalfLifeApprovedAt", "Approved At"),
    reviewer: f<string>("fldHalfLifeReviewer", "Reviewer"),
  },
} as const

export const RSVP = {
  tableId: process.env.AIRTABLE_RSVP_TABLE_ID ?? "RSVPs",
  fields: {
    email: f<string>("fldRsvpEmail", "Email"),
    firstName: f<string>("fldRsvpFirstName", "First Name"),
    lastName: f<string>("fldRsvpLastName", "Last Name"),
    pronouns: f<string>("fldRsvpPronouns", "Pronouns"),
    ip: f<string>("fldRsvpIp", "IP"),
    utmSource: f<string>("fldRsvpUtmSource", "UTM Source"),
    referredBy: f<string>("fldRsvpReferredBy", "Referred By"),
    signupPage: f<string>("fldRsvpSignupPage", "Loops - halfLifeSignUpPage"),
    finishedAccountCreation: f<boolean>(
      "fldRsvpFinished",
      "Finished Account Creation",
    ),
    // Stasis joins RSVPs to users on email alone, which breaks when someone
    // RSVPs with a personal address and signs in through HCA with a school one.
    userId: f<string>("fldRsvpUserId", "Half-Life User ID"),
  },
} as const

type FieldMap = Record<string, FieldDef>

type ValuesFor<S extends FieldMap> = Partial<{
  [K in keyof S]: S[K] extends FieldDef<infer T> ? T : never
}>

/** Build an Airtable `fields` payload, keyed however FIELD_MODE says. */
export function toFields<S extends FieldMap>(
  schema: S,
  values: ValuesFor<S>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    const field = schema[key]
    if (!field) continue
    out[fieldKey(field)] = value
  }
  return out
}
