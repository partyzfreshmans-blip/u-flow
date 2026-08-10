# Unii Warehouse Ops

Warehouse / delivery operations UI for Uniimart LPN. All operational data is
read from Google Sheets; customer coordinates can be written back.

> The driver-facing route picker for branch 584 used to live here under
> `apps-script/`. It now has its own repository,
> [`unii-routes-584`](https://github.com/partyzfreshmans-blip/unii-routes-584),
> and its own spreadsheet — it reads this app's order data read-only and
> writes nothing back, so nothing in this repo depends on it.

## Running

```bash
npm install
npm run dev      # frontend (Vite) — http://localhost:5173, proxies /api to the server below
npm run server   # write-back API — http://localhost:8787
```

The frontend works without the backend; only the **save** actions need it
(customer lat/lng, order edits, file attachments) — everything else is
read-only from the public Sheets CSV export.

## Deploying (Vercel)

The site is deployed on Vercel. The frontend (static Vite build) and the
backend both ship from this one repo — the backend lives twice, once as
`server/index.ts` (an Express app, used only by `npm run server` for local
dev) and once as Vercel serverless functions under `api/`, both calling the
same shared handlers in `server/lib.ts` so the two never drift apart.
Nothing in the frontend needs to know which one it's talking to — it always
calls relative `/api/...` paths, so **the write features only work once the
same environment variables from `.env.example` (`GOOGLE_SERVICE_ACCOUNT_KEY`,
`GOOGLE_DRIVE_ROOT_FOLDER_ID`) are also set as Vercel Project → Settings →
Environment Variables**, then redeployed. Until then, save actions on the
deployed site fail with a "เชื่อมต่อ backend ไม่ได้" error — that's the
serverless functions running but refusing for lack of credentials, not the
functions being missing.

## Data sources

Every sheet ID and gid lives in `src/config/sheets.ts` — change them there,
nowhere else. Reads use the public CSV export (no credentials), are cached for
~45s, and fall back to the last good response if a fetch fails.

| Page | Sheet tab | Mode |
| --- | --- | --- |
| แดชบอร์ด / ออเดอร์ใหม่ | API Import | read |
| จัดการออเดอร์ | คำสั่งซื้อ | read + write วันที่จะจัดส่ง/หมายเหตุ/ใบกำกับภาษี |
| รายการสินค้าในออเดอร์ (modal) | SKU Detail | read |
| โปรโมชั่น | โปรโมชั่น (`Status = Active` only) | read |
| ฐานข้อมูลลูกค้า | CS Master | read + write lat/lng |
| ฐานข้อมูลสินค้า | SKU Master (separate file) | read |

COD clearing, batch picking, and GRN still use local sample data — they were
out of scope for the Sheets migration.

## Setting up the write-back backend

Writing to a sheet needs credentials, so lat/lng edits, order edits, and file
attachments all go through the small backend (`server/` locally, `api/` on
Vercel — see "Deploying" above). The private key stays server-side and never
reaches the browser bundle.

1. In Google Cloud console: create a project (or reuse one) and **enable the
   Google Sheets API**.
2. Create a **Service Account**, then create a **JSON key** for it and
   download the file.
3. Copy the service account's email (looks like
   `something@project-id.iam.gserviceaccount.com`).
4. Open the **Monthly Sheet** spreadsheet → Share → paste that email → give it
   **Editor** → Share.
5. `cp .env.example .env`, then paste the *entire contents* of the downloaded
   JSON key as a single-line value for `GOOGLE_SERVICE_ACCOUNT_KEY`.
6. `npm run server` — check `http://localhost:8787/health` reports
   `"serviceAccountConfigured": true`.

`.env` is gitignored. Never commit it, and never put the key in frontend code
(anything in `src/` ships to the browser).

### How write-back targets a row

`POST /api/cs-master/update-location` finds the row by customer name plus the
last 9 digits of the phone number (formats in the sheet are inconsistent), then
updates only columns D/E (ละ/ลอง) of that row — it never appends. If the name
is ambiguous across multiple rows it returns 409 rather than guessing.
