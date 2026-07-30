# Postgres migration — Phase 1 (schema + connection setup)

Status: **scaffolding only**. Nothing in the running app reads from or
writes to Postgres yet — Google Sheets remains the live source of truth.
This phase exists so that once a `DATABASE_URL` is set, the schema and
connection client are ready to use, without the app's actual behavior
changing at all.

## Provider: Neon

Recommended over Supabase for this project specifically:

- **Serverless-native, matches Vercel's own deploy model.** u-flow's backend
  is entirely Vercel Serverless Functions (`api/*.ts`) with bursty,
  low-frequency traffic (a small warehouse ops team, not a public app).
  Neon scales to zero between requests and its pooled connection endpoint
  (pgbouncer) is built for exactly this "many short-lived serverless
  connections" pattern. Vercel's own first-party "Vercel Postgres" product
  is, in fact, Neon under the hood — so this is the path with the least
  integration friction: add the Neon integration from the Vercel dashboard
  (or paste the connection string manually) and it's done.
- **Scope matches what's needed.** Supabase bundles auth, storage, realtime,
  and a Table Editor UI on top of Postgres. u-flow already has its own RBAC
  (the `users` table + scrypt password hashing in `server/lib.ts`) and its
  own file storage (Google Drive, see `src/config/drive.ts`) — none of
  Supabase's extra platform surface would get used. Neon is closer to "just
  a Postgres database," which is all this phase asked for.
- **Room to grow.** If a future phase does want managed auth, storage, or a
  built-in admin UI, Supabase remains a fine option then — but adopting that
  surface area isn't a decision this phase needs to make, and starting
  minimal (Neon) doesn't foreclose it later (the schema and client here
  don't depend on anything Neon-specific).

The connection client (`server/db.ts`, using `postgres.js`) speaks plain
Postgres wire protocol, so if this recommendation is ever revisited, moving
to Supabase (or any other Postgres host) needs no code changes — only a
different `DATABASE_URL`.

## Environment variable to set

Set exactly one, wherever the connection string comes from:

```
DATABASE_URL=postgres://user:password@host:5432/dbname?sslmode=require
```

- Locally: add it to `.env` (already gitignored).
- Production: set it as a Vercel project environment variable (Project →
  Settings → Environment Variables). Never commit it.

After setting it, confirm it actually connects:

```
node scripts/db-smoke-test.mjs
```

This writes a throwaway row to a scratch table, reads it back, and drops the
table again — it doesn't touch any of the real schema below.

## Applying the schema

```
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
```

## Tables created

| Table | Source in the current app |
|---|---|
| `customers` | CS Master tab (`src/data/sources/csMaster.ts`) |
| `sku_master` | SKU Master tab (`src/data/sources/skuSheet.ts`) |
| `promotions` | โปรโมชั่น tab (`src/data/sources/promotionsSheet.ts`) |
| `batch_routes` | Batch Route history (`src/data/batchRoutes.ts`, Sheets-backed) |
| `orders` | StaffOrderInfo / คำสั่งซื้อ VS tab (`src/data/types.ts`) |
| `order_line_items` | SKU Detail tab (`src/data/types.ts`'s `OrderLineItem`) — *not* in the original table list, added for fidelity (see below) |
| `users` | RBAC (`server/lib.ts`, Sheets-backed) |
| `activity_log` | `src/data/activityLog.ts` (currently browser localStorage only) |
| `goods_receiving`, `goods_receiving_lines` | `src/data/receiving.ts` (currently browser localStorage only) |
| `batch_picking`, `batch_picking_orders`, `batch_picking_picks` | `src/data/pickLots.ts` (currently browser localStorage only) |
| `delivery_bookings` | Driver stop-booking (`server/lib.ts`, Sheets-backed) |
| `attachments` | File metadata only — actual files stay on Google Drive (`src/data/sources/attachments.ts`) |

Full column-by-column reasoning, including every place this schema
deliberately diverges from a literal 1:1 field port, is documented as SQL
comments directly above each table in `db/migrations/0001_init.sql`. The
short version of each deviation:

- **`customers.lat/lng_from_unii` vs `lat/lng_override`** — today only the
  override is stored on the customer (CS Master); the raw Unii coordinate
  actually lives on each order row. Storing both on `customers` here is a
  real normalization improvement, not a straight port — a future data
  migration would need to backfill `lat_from_unii`/`lng_from_unii`.
- **`goods_receiving`** is two tables (`goods_receiving` +
  `goods_receiving_lines`), because the real feature already has a
  record/line-items shape, not one flat table.
- **`order_line_items`** exists even though it wasn't in the original list,
  because promotion usage is tracked per line item today (`OrderLineItem.
  promoSku`), not per order — without this table there's nowhere to store
  that, and `orders.promotion_id` alone would lose that granularity.
  `orders.promotion_id` is kept too, as a simplified order-level summary.
- **`attachments.entity_key`** is a generic string, not a strict
  `order_uid` foreign key — attachments have three scopes today (`order`,
  `receiving`, `deliveryFailure`), not just orders.
- **`batch_routes` has no stored "total sales" column** — that number is
  computed live from `order_line_items` today, and the schema keeps it that
  way via the `batch_route_totals` view, rather than caching a number that
  could drift from its source. Same for `orderNos` membership: it's
  expressed via `orders.batch_route_id` instead of a stored array.
- **`batch_picking`**'s per-order summaries and merged SKU lines are
  likewise left as joins against `orders`/`order_line_items` rather than
  cached columns — only the two things with no other source (which SKUs are
  physically checked off, and whether an order's post-close status
  write-back is still pending) get their own tables.

Not represented at all in this phase (flagged, not solved): raw Unii import
data (`ApiImportOrder` — customer name/amount/item count/raw status/
timestamps as Unii itself sends them) has no table here, because the user's
own description of `orders` was staff-entered data specifically. A future
migration phase needs a decision on where that raw import data lives once
Postgres is live — a mirror table, or continuing to read it live from
Sheets/Unii even after everything else moves over.

## Connecting from code

`server/db.ts` exports `getDb()`, a lazily-initialized `postgres.js` client.
It is not imported by any current handler — wiring it into `server/lib.ts`
or `api/*.ts` is a future phase, once real data has actually been migrated.
See that file's comments for why `postgres.js` was chosen over Prisma or
Drizzle.
