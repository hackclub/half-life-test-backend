# Half-Life

The platform behind Half-Life, a 10-week hardware program from Hack Club.

Weeks 1–5 are themed **design** weeks; weeks 6–10 are the matching **build**
weeks. The five themes, in order: **PCBs, CAD, Synth, Displays, Breadboard
Computer**. Each participant ends up with five themed projects, each reviewed
twice. A reviewer assigns a funding tier when a design is approved — that tier
is the parts budget. Hours logged beyond the tier minimum become shop credit,
which buys upgrades for the 3D printer you earn by shipping all five themes.

## Quick start

```sh
cp .env.example .env      # fill in HCA credentials at minimum
./dev.sh                  # Postgres in Docker, migrate, seed, next dev
```

Then sign in once and give yourself admin:

```sh
yarn grant-role you@hackclub.com ADMIN
```

Or set `SUPERADMIN_EMAILS` before your first sign-in and it happens automatically.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Prisma 7 + Postgres ·
better-auth (Hack Club Auth + Hackatime) · Zod · Tailwind v4 · Cloudflare R2 ·
deployed on Orchard.

**Postgres is the source of truth.** Airtable holds the RSVP funnel and the
`YSWS Project Submission` rows Hack Club's payout pipeline reads — it is a sink,
not a store. See `docs/ARCHITECTURE.md` for why.

## Commands

| command | what it does |
|---|---|
| `./dev.sh` | full local stack |
| `yarn typecheck` | `tsc --noEmit`; CI fails without it |
| `yarn lint` | eslint; CI fails without it |
| `yarn db:migrate --name x` | create and apply a migration |
| `yarn db:seed` | idempotent: settings row plus shop items |
| `yarn grant-role <email> <ROLE>` | ADMIN, REVIEWER, FULFILLER or AUDITOR |
| `yarn verify:ledger` | end-to-end check that approve → un-approve → re-approve converges |
| `yarn dump-airtable-schema` | print field ids to paste into `lib/airtable/schema.ts` |

## Layout

```
app/                pages (server components) and app/api/**/route.ts
app/components/ui   presentational primitives — the whole restyle surface
app/components/forms client components; interaction only
lib/                business logic; route handlers stay thin
lib/config/         every tunable program number (themes, weeks, tiers, rates)
lib/queries/        server-only read path for pages
lib/schemas/        Zod schemas, shared between client forms and route handlers
prisma/             schema and migrations
docs/               architecture notes and the Orchard runbook
```

## Deploy

Orchard, org `ysws`. See `docs/RUNBOOK.md` for the step-by-step.

## The visual design is not finished

Every colour, radius and font lives in `app/globals.css` and
`app/components/ui/`. Pages compose semantic primitives and contain no styling
decisions, so the eventual visual pass is: rewrite those files, done.
