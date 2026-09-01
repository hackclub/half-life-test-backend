# CLAUDE.md

## The program

Half-Life is a 10-week Hack Club YSWS hardware program. Weeks 1–5 are themed
DESIGN weeks; weeks 6–10 are the matching BUILD weeks. Themes in order: PCBs,
CAD, Synth, Displays, Breadboard Computer. Each participant has exactly five
themed projects (one per theme), each with a design and a build submission.

A reviewer assigns one of three funding tiers **when a design is approved** —
that tier is the participant's parts budget, so it has to be decided before they
start building, not after. Hours logged beyond the tier minimum convert to shop
credit, which buys upgrades for the 3D printer that shipping all five themes
earns.

## Commands

Package manager is **yarn**. `./dev.sh` for local development. Before pushing:
`yarn typecheck && yarn lint` — CI runs both and will fail the PR. There is no
test framework; `yarn verify:ledger` is the one end-to-end check, and it must
keep passing.

## The rule that matters most

**The visual design is not finished.** Every page must be trivially restylable.

- Data fetching lives in server components (via `lib/queries/*`) or in route
  handlers. Never `useEffect(() => fetch(...))` to load a page's data.
- Client components are for interaction only: form state, dialogs, optimistic
  UI. They take data as props and call `router.refresh()` after a mutation.
- Colours, spacing, radii and fonts exist **only** in `app/globals.css` and
  `app/components/ui/`. Pages use semantic primitives (`<Panel>`,
  `<Button variant="danger">`), never a raw colour utility.
- If you are about to write a hex code outside those two places, add a token
  instead.

## API conventions

Every route handler, in this order:

1. Auth guard — `requireSession()` / `requirePermission(Permission.X)` /
   `requireIntegrationAuth(request)`. Return the guard's error response as-is.
2. Parse and validate — `parseBody(request, SomeSchema)`. Never read a field off
   an unvalidated object. Never `any`.
3. Authorise the object — ownership, soft-delete and state checks.
4. Mutate, inside `prisma.$transaction` when more than one row changes.
5. `logAudit(...)` — every mutation, with `{ before, after }` in the metadata.
6. `after(() => ...)` for anything the caller does not need to wait for.
7. Return `ok(data)` or `fail(code, message)`.

Status discipline: 400 malformed, 401 no session, 403 authenticated but not
permitted, **404 for both "missing" and "not yours"** (never leak the ID space),
409 for wrong-state conflicts (already submitted, claimed elsewhere, insufficient
credit), 422 well-formed but semantically impossible, 503 dependency
unconfigured.

## Data conventions

- **The ledger is append-only.** Never update or delete a `LedgerEntry`. Money
  that depends on a reviewable decision goes through `reconcileGrant`, which
  appends a delta so the sum matches a target — that is what makes re-review
  idempotent. Un-approving is `reconcileGrant(..., { target: 0 })`, not a
  bespoke reversal path.
- Balance is always `SUM(amount)`. `balanceBefore`/`balanceAfter` are an audit
  aid; if they ever disagree with the sum, a write escaped its transaction.
- **Every transaction that reads a balance and then writes against it must call
  `lockUserCredit(tx, userId)` first.** Because the balance is an aggregate over
  an append-only table there is no row to lock, and READ COMMITTED lets two
  concurrent requests both read the same balance and both commit — a real
  double-spend, with physical goods on the other side. The
  `@@unique([shopOrderId, kind])` constraint does not help: two concurrent
  purchases mint two different order ids.
- Soft delete via `deletedAt`. Every read filters `deletedAt: null`.
- Sanitize free text: `sanitize()` for plain text, `sanitizeHtml()` for journal
  content. Zod checks shape, DOMPurify checks content; neither substitutes.
- Pagination is cursor-based, ordered by a compound key ending in `id`.

## Review integrity

- **Nobody reviews their own work.** Every account owns five themed projects,
  reviewers included, so this is not an edge case. `claimSubmission` and
  `finalizeReview` refuse it, `POST /api/review/hours` refuses it, and the queue
  and detail queries filter it out. Admins are not exempt — the point is a
  second pair of eyes, not a trust level.
- `grantUsdOverride` requires `MANAGE_CREDIT`. The tier table is a reviewer's
  whole vocabulary for funding; a freehand dollar amount on a grant row is an
  admin action.
- **Hackatime is link-only** (`disableSignUp`, `disableImplicitSignUp`, and not
  in `trustedProviders`). It does not verify email ownership, so allowing it as
  a sign-in identity would let anyone who registers a Hackatime account under
  someone else's address sign in as them. HCA is the only identity provider.
- The `SUPERADMIN_EMAILS` bootstrap only fires for an account whose email the
  identity provider actually verified.

## Hours

Three sources, and two of them can double-count if you are careless:

- Journal sessions and Hackatime links are **additive** — but a session marked
  `HACKATIME_TRACKED` contributes zero, because its time already arrives through
  the link.
- Timelapse is **evidence, not a bucket**. Its duration is never added to any
  total; it surfaces as a coverage ratio against claimed time.
- Approving refuses outright when Hackatime data is stale, rather than counting
  a failed fetch as zero hours and silently underpaying someone.

## Airtable

Airtable is a sink. Postgres owns everything transactional.

- The `YSWS Project Submission` field names are not ours to choose — Hack Club's
  payout pipeline reads them. A typo means someone does not get paid.
- Writes use `performUpsert` keyed on `(Half-Life ID, Stage)`. Never
  read-then-write: two concurrent approvals both read zero rows and both create.
- `typecast: false` always, or a typo in a theme name silently invents a sixth
  theme.
- Every `filterByFormula` interpolation goes through `escapeAirtableValue`.
- Never hand an `airtableusercontent.com` URL to a browser — those expire.
  Images live in R2 and Airtable references them.

## Migrations

Never hand-write or generate a migration SQL file. Run
`yarn db:migrate --name descriptive_name` against a live database. CI verifies
that migrations apply from scratch and that the committed schema matches them.

## Program configuration

`lib/config/program.ts` and `lib/config/tiers.ts` hold every tunable number. If
you are about to hardcode a threshold somewhere else, put it there instead.
Tier 2 and Tier 3 values are placeholders and will change; every review freezes
the numbers it used, so editing them never rewrites anyone's history.

Live operational switches (submissions open, shop open, event start date,
Airtable sync) are **database rows**, edited at `/admin/program`, not env vars.
Stasis put its submission gate in an env var, nobody flipped it in the
dashboard, and submissions stayed open for two weeks after the event ended.

## Deploy

Orchard (org `ysws`), Docker from the repo root Dockerfile, auto-deploy from
`main`. Scheduled work is Orchard jobs that `curl -f` the bearer-gated
`/api/integrations/*` routes. Not Vercel, not Coolify. See `docs/RUNBOOK.md`.
