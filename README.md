# Unii Warehouse Ops

Warehouse / delivery operations UI for Uniimart LPN. All operational data is
read from Google Sheets; customer coordinates can be written back.

## Running

```bash
npm install
npm run dev      # frontend (Vite) — http://localhost:5173
npm run server   # CS Master write-back API — http://localhost:8787
```

The frontend works without the backend; only the customer lat/lng **save**
button needs it.

## Data sources

Every sheet ID and gid lives in `src/config/sheets.ts` — change them there,
nowhere else. Reads use the public CSV export (no credentials), are cached for
~45s, and fall back to the last good response if a fetch fails.

| Page | Sheet tab | Mode |
| --- | --- | --- |
| แดชบอร์ด / ออเดอร์ใหม่ | API Import | read |
| จัดเส้นทางส่ง / ประวัติการจัดส่ง | คำสั่งซื้อ | read |
| รายการสินค้าในออเดอร์ (modal) | SKU Detail | read |
| โปรโมชั่น | โปรโมชั่น (`Status = Active` only) | read |
| ฐานข้อมูลลูกค้า | CS Master | read + write lat/lng |
| ฐานข้อมูลสินค้า | SKU Master (separate file) | read |

COD clearing, batch picking, and GRN still use local sample data — they were
out of scope for the Sheets migration.

## Setting up CS Master write-back

Writing to a sheet needs credentials, so lat/lng edits go through the small
backend in `server/`. The private key stays server-side and never reaches the
browser bundle.

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
