import "server-only"
import {
  airtableFetch,
  escapeAirtableValue,
  getAirtableConfig,
  withRateLimitRetry,
  AirtableError,
  type AirtableRecord,
} from "@/lib/airtable/client"
import { YSWS_SUBMISSION, fieldKey, formulaRef, toFields } from "@/lib/airtable/schema"

export type YswsStage = "Design" | "Build"

export interface YswsSubmissionPayload {
  halfLifeId: string
  stage: YswsStage
  theme: string
  firstName: string
  lastName: string
  email: string
  slackId: string | null
  codeUrl: string | null
  description: string | null
  /** Public R2 URL. Airtable fetches it into the attachment field. */
  screenshotUrl: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  country: string | null
  zip: string | null
  birthday: string | null
  totalHours: number
  hoursJustification: string | null
  grantUsd: number
  complexityTier: string
  weekSubmitted: number | null
  onTime: boolean
  approvedAt: string | null
  reviewerName: string | null
}

function fieldsFor(p: YswsSubmissionPayload): Record<string, unknown> {
  const fields = toFields(YSWS_SUBMISSION.fields, {
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    codeUrl: p.codeUrl ?? "",
    // The pipeline expects a playable URL. Hardware has none, so stasis sends
    // the repo for both and we match that.
    playableUrl: p.codeUrl ?? "",
    description: p.description ?? "",
    addressLine1: p.addressLine1 ?? "",
    addressLine2: p.addressLine2 ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    country: p.country ?? "",
    zip: p.zip ?? "",
    ...(p.birthday ? { birthday: p.birthday } : {}),
    overrideHours: p.totalHours,
    ...(p.hoursJustification ? { overrideHoursReason: p.hoursJustification } : {}),
    grantAmount: p.grantUsd,
    complexityTier: p.complexityTier,
    slackId: p.slackId ?? "",
    halfLifeId: p.halfLifeId,
    stage: p.stage,
    theme: p.theme,
    ...(p.weekSubmitted !== null ? { weekSubmitted: p.weekSubmitted } : {}),
    onTime: p.onTime,
    ...(p.approvedAt ? { approvedAt: p.approvedAt } : {}),
    reviewer: p.reviewerName ?? "",
  })
  // Attachments are written as a URL Airtable fetches, so the bytes live in R2
  // and Airtable only references them.
  if (p.screenshotUrl) {
    fields[fieldKey(YSWS_SUBMISSION.fields.screenshot)] = [{ url: p.screenshotUrl }]
  }
  return fields
}

/**
 * Upsert the grant row for one (themed project, stage).
 *
 * Uses Airtable's native atomic `performUpsert` rather than the read-then-write
 * that stasis does. Two concurrent approvals of the same project — an admin
 * double-click, a retried request — both read zero rows and both create,
 * putting duplicate grant rows into the payout sink. `performUpsert` is one
 * call and cannot race with itself.
 *
 * `typecast: false` is deliberate: with typecast on, a single-select value we
 * did not create is silently added as a new option, so a typo in a theme name
 * quietly invents a sixth theme in the base.
 */
export async function upsertYswsSubmission(
  payload: YswsSubmissionPayload,
): Promise<{ recordId: string } | { skipped: "not_configured" }> {
  const config = getAirtableConfig()
  if (!config) {
    console.warn("[airtable] not configured; skipping YSWS submission upsert")
    return { skipped: "not_configured" }
  }

  const body = {
    performUpsert: {
      fieldsToMergeOn: [
        fieldKey(YSWS_SUBMISSION.fields.halfLifeId),
        fieldKey(YSWS_SUBMISSION.fields.stage),
      ],
    },
    records: [{ fields: fieldsFor(payload) }],
    typecast: false,
  }

  const result = await withRateLimitRetry("upsertYswsSubmission", () =>
    airtableFetch<{ records: AirtableRecord[] }>(config, YSWS_SUBMISSION.tableId, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  )
  const record = result.records[0]
  if (!record) throw new Error("Airtable upsert returned no record")
  return { recordId: record.id }
}

/**
 * Remove the grant rows for a (themed project, stage) and report the unified
 * base record ids they carried, so those can be deleted by exact id.
 *
 * Deleting from the unified base by Code URL would be wrong twice over: the URL
 * is not unique across programs, and here all five of a participant's themed
 * projects may live in one monorepo.
 */
export async function deleteYswsSubmission(
  halfLifeId: string,
  stage: YswsStage,
): Promise<{ deleted: string[]; unifiedRecordIds: string[]; skipped?: string; error?: string }> {
  const config = getAirtableConfig()
  if (!config) return { deleted: [], unifiedRecordIds: [], skipped: "not_configured" }

  const formula = `AND(${formulaRef(YSWS_SUBMISSION.fields.halfLifeId)} = '${escapeAirtableValue(halfLifeId)}', ${formulaRef(YSWS_SUBMISSION.fields.stage)} = '${escapeAirtableValue(stage)}')`

  try {
    const found = await withRateLimitRetry("findYswsSubmission", () =>
      airtableFetch<{ records: AirtableRecord[] }>(
        config,
        `${YSWS_SUBMISSION.tableId}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=10`,
      ),
    )
    if (found.records.length === 0) return { deleted: [], unifiedRecordIds: [] }

    const unifiedRecordIds = found.records
      .map((r) => r.fields[YSWS_SUBMISSION.fields.unifiedRecordId.name])
      .filter((v): v is string => typeof v === "string" && v.length > 0)

    const query = found.records.map((r) => `records[]=${encodeURIComponent(r.id)}`).join("&")
    await withRateLimitRetry("deleteYswsSubmission", () =>
      airtableFetch<{ records: { id: string }[] }>(
        config,
        `${YSWS_SUBMISSION.tableId}?${query}`,
        { method: "DELETE" },
      ),
    )
    return { deleted: found.records.map((r) => r.id), unifiedRecordIds }
  } catch (err) {
    // A missing write grant is an ops problem, not a reason to fail the
    // un-approval that the admin is in the middle of.
    if (err instanceof AirtableError && err.isPermission) {
      return {
        deleted: [],
        unifiedRecordIds: [],
        skipped: "no_write_access",
        error: err.message,
      }
    }
    throw err
  }
}

/** Remove rows in the shared unified base by exact record id. */
export async function deleteUnifiedRecords(
  recordIds: string[],
): Promise<{ deleted: string[]; skipped?: string; error?: string }> {
  if (recordIds.length === 0) return { deleted: [] }
  const apiKey = process.env.AIRTABLE_API_KEY
  const baseId = process.env.AIRTABLE_UNIFIED_BASE_ID
  const table = process.env.AIRTABLE_UNIFIED_APPROVED_TABLE
  if (!apiKey || !baseId || !table) return { deleted: [], skipped: "not_configured" }

  const query = recordIds.map((id) => `records[]=${encodeURIComponent(id)}`).join("&")
  try {
    const result = await withRateLimitRetry("deleteUnifiedRecords", () =>
      airtableFetch<{ records: { id: string }[] }>(
        { apiKey, baseId },
        `${table}?${query}`,
        { method: "DELETE" },
      ),
    )
    return { deleted: result.records.map((r) => r.id) }
  } catch (err) {
    if (err instanceof AirtableError && err.isPermission) {
      return { deleted: [], skipped: "no_write_access", error: err.message }
    }
    throw err
  }
}
