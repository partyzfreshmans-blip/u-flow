# u-flow — Handoff Prompt & Developer Guide for Antigravity / IDE (PC & Mac)

> **บริบทโปรเจกต์**: `u-flow` คือเว็บแอประบบจัดการคลังสินค้าและจัดส่งประจำวันของ **Unii Mart สาขา 584 (เชียงใหม่-ลำพูน)**
> **Production URL**: [https://u-flow-nu.vercel.app](https://u-flow-nu.vercel.app)
> **GitHub Repository**: `partyzfreshmans-blip/u-flow`
> **Active Branch**: `claude/warehouse-ops-design-gl85la`
> **ผู้ใช้งานจริง**: หัวหน้าคลัง (Administrator/Manager), แอดมิน (Admin Staff), คนจัดของ (Picker), คนตรวจของ (Checker), และคนขับรถส่งของ (Driver 5-8 คน) ใช้งานจริงทุกวัน

---

## 🛠️ 1. Tech Stack & สถาปัตยกรรมระบบ

- **Frontend**: React 19 + TypeScript + Vite
  - **Routing**: State-driven Routing (`state.route` ใน `src/state/store.ts`) ไม่ใช้ react-router
  - **Styling**: Vanilla CSS + Inline Styles (`src/styles/nocturne.css`)
  - **Map Engine**: Leaflet + `@geoman-io/leaflet-geoman-free` (วาดและแก้ไข Polygon โซน)
- **Backend**: TypeScript บน Node.js
  - **Production**: Vercel Serverless Functions (`api/` directory)
  - **Local Development**: Express Server (`server/index.ts`) พอร์ต `8787`
  - **Business Logic ทั้งหมด**: รวมศูนย์อยู่ที่ `server/lib.ts` (ทั้ง Vercel API และ Express เรียกใช้ฟังก์ชันเดียวกัน)
- **Data Persistence (ฐานข้อมูล)**: **Google Sheets API v4 เท่านั้น — ไม่มี Database SQL/NoSQL**
  - เข้าถึงผ่าน Google Cloud Service Account (`GOOGLE_SERVICE_ACCOUNT_KEY`)
  - **Spreadsheet หลัก (`MAIN_SHEET_ID`)**: `1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U`
  - **Spreadsheet สินค้า (`SKU_SHEET_ID`)**: `1_qE1NtIfLfa2Vn0AXFxfGoD9daZB34OtLnv08Tc-o54`
- **File Uploads**: Google Drive API ผ่าน Service Account เดียวกัน (`GOOGLE_DRIVE_ROOT_FOLDER_ID`)
- **Authentication**: Custom HMAC-SHA256 Signed Session Token (`server/session.ts`) ใช้ `AUTH_SESSION_SECRET`

---

## 🚨 2. กฎเหล็ก Invariants ทั้ง 9 ข้อ (ห้ามละเมิดเด็ดขาด)

1. **การตัดสินโซน (Zone Matching)**: ต้องตัดสินจากพิกัด GPS (`lat`/`lng` ภายใน Polygon ของ Turf.js) **เท่านั้น** ห้ามใช้ข้อความที่อยู่/ตำบล/อำเภอมาตัดสิน
2. **Zone Wall**: คนขับส่งของเฉพาะในโซนตนเอง หากต้องการวิ่งข้ามโซนต้องส่งคำขอจองคิว (`Bookings`) ให้หัวหน้าคลังอนุมัติก่อนเท่านั้น
3. **ห้ามมี Auto-Sequencing ในรูท (STRICT NO AUTO-SORT)**:
   - ระบบ Auto-assign (`suggestByZone`) ทำหน้าที่แค่ **"จัดออเดอร์ลงรถตามโซน"**
   - **ห้ามใส่โค้ด Sort (เช่น `byFarthestFirst` หรือ Nearest) จัดลำดับจุดส่งอัตโนมัติเด็ดขาด** — คนขับและหัวหน้าคลังต้องเป็นผู้จัดเรียงลำดับจุดส่งเอง
4. **การแก้ขอบเขตโซน (Polygon Edits)**: เมื่อแก้ขอบเขตโซน ระบบจะขึ้นเตือนให้ผู้ใช้จัดใหม่ **ห้ามย้ายหรือ Re-assign ออเดอร์ที่อยู่ใน Batch แล้วโดยอัตโนมัติ**
5. **แท็บ `API Import` เป็น Append-Only**: รับข้อมูลจาก Unii Webhook ให้อ่านตรงสดเสมอ (2,659 รายการ) ห้ามเขียนทับ
6. **คอลัมน์ K และ L ในแท็บ `คำสั่งซื้อ VS` เป็นสูตร Array Formula**:
   - คอลัมน์ K = `new customer`
   - คอลัมน์ L = `เบอร์โทร 10 หลัก`
   - ฟังก์ชัน `assertWritableColumn` ใน `server/lib.ts` ต้องบล็อกการเขียนทับคอลัมน์เหล่านี้ 100%
7. **CS Master Phone เป็นค่าหลักเสมอ**: จับคู่เบอร์โทรด้วย `phoneKey` (ตัด `66` และใช้ 9 หลักท้าย) และเมื่อแก้ไขพิกัด ต้องบันทึก Tag `_PINFIX` ลงใน `Audit Log`
8. **การแก้ไข Product_Master (SKU)**: ต้องผ่านการอนุมัติของหัวหน้าคลัง และบันทึกกลับ Google Sheet เสมอ
9. **GPS คนขับ**: บันทึกพิกัดคนขับเฉพาะตอนที่กดยืนยันส่งมอบงานสำเร็จเท่านั้น

---

## ⚠️ 3. ข้อจำกัด Vercel Serverless Function Cap (12 Functions)

- บัญชี Vercel Hobby จำกัด Serverless Function ไม่เกิน **12 Functions**
- ปัจจุบันโปรเจกต์ใช้เต็มโควต้า 12 Functions พอดี ผ่านโครงสร้าง Catch-all `[[...slug]].ts`:
  - `api/auth/[[...slug]].ts`
  - `api/batch-routes/[[...slug]].ts`
  - `api/bookings/[[...slug]].ts`
  - `api/cs-master/[[...slug]].ts`
  - `api/promotions/[[...slug]].ts`
  - `api/route-orders/[[...slug]].ts`
  - `api/sku-detail/[[...slug]].ts`
  - `api/sku-master/[[...slug]].ts`
  - `api/users/[[...slug]].ts`
  - `api/zones/[[...slug]].ts`
  - `api/health.ts`
  - `api/geocode/reverse.ts`
- **กฎสำคัญ**: **ห้ามสร้างไฟล์ใหม่ที่ Root ของโฟลเดอร์ `api/` เด็ดขาด** หากต้องการเพิ่ม Endpoint ให้เพิ่มเป็น sub-path ภายใต้ Catch-all เดิม และเชื่อม Route ใน `server/index.ts`

---

## 💻 4. ขั้นตอนการ Setup บนเครื่อง PC ใหม่

### 4.1 Clone Repo & ติดตั้ง Dependencies
```bash
git clone https://github.com/partyzfreshmans-blip/u-flow.git
cd u-flow
git checkout claude/warehouse-ops-design-gl85la
npm install
```

### 4.2 สร้างไฟล์ `.env`
สร้างไฟล์ `.env` ที่ root ของโปรเจกต์ โดยใส่ค่า Environment Variables:
```env
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
GOOGLE_DRIVE_ROOT_FOLDER_ID=1xxxxxxxxxxxxxxxxxxxxxxxxx
AUTH_SESSION_SECRET=your-secure-random-hmac-secret-string-min-32-chars
NODE_ENV=development
```

### 4.3 คำสั่งรันโปรเจกต์
- **รัน Backend (Terminal 1)**:
  ```bash
  npm run server
  ```
  *(Backend จะรันที่ `http://localhost:8787`)*
- **รัน Frontend (Terminal 2)**:
  ```bash
  npm run dev
  ```
  *(Frontend Vite จะรันที่ `http://localhost:5173` พร้อม Proxy `/api` ไปยัง port `8787`)*

---

## 🧪 5. คำสั่งทดสอบและตรวจสอบความถูกต้อง (Verification)

ก่อนส่งงานหรือ Commit โค้ดทุกครั้ง ต้องรัน 2 คำสั่งนี้:

1. **รัน Invariant & Security Integration Test Suite**:
   ```bash
   npx tsx scratch/test_invariants.ts
   ```
   *(ต้องผ่านครบทั้ง Invariant 1, 3, 4, 6, 7 และ Token Invalidation)*

2. **ตรวจสอบ Type และ Lint**:
   ```bash
   npm run build && npm run lint
   ```
   *(ต้องไม่มี TypeScript Error และไม่มี Lint Error)*

---

## 📂 6. โครงสร้างไฟล์สำคัญ (Key Files Map)

- `server/lib.ts` — แกนหลักของ Backend Logic, Google Sheets API calls, RBAC verification, Audit Log, และ Data mapping
- `server/session.ts` — การสร้าง/ตรวจสอบ Session Token, Password hashing (`scrypt`), Auth guards
- `src/state/store.ts` — AppState ทั้งหมด, Reducer, Action handlers, Data fetchers
- `src/state/derive.ts` — View-model computation แต่ละหน้า (`computePlanner`, `computeOrderManagement`, `computeCod`, `computeDriverDayPicker`)
- `src/pages/PlannerPage.tsx` — หน้าวางแผนจัดรูท แผนที่ขนาดใหญ่ 55%, Fullscreen map modal, Vehicle buckets, Unassigned orders table พร้อมปุ่ม `PhoneCallButton`
- `src/pages/RouteMap.tsx` — Leaflet Map component พร้อม `ResizeObserver` และ Custom High-Contrast Pins
- `src/pages/DriverPage.tsx` — หน้าจอมือถือสำหรับคนขับรถส่งของ รองรับ Offline outbox queue
- `src/config/permissions.ts` — Source of truth ของ Role & Permission matrix ทั้ง 6 roles
- `src/config/sheets.ts` — Sheet IDs, Tab Names, GIDs ทั้งหมดในระบบ
