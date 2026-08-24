import { Fragment, useState } from 'react';
import { CopyButton } from '../components/CopyButton';
import { OrderDetailModal } from '../components/OrderDetailModal';
import { computeDashboard } from '../state/derive';
import type { AppActions, AppState } from '../state/store';
import { RouteCalendarPanel } from './RouteCalendarPanel';
import { RouteMap } from './RouteMap';

type DashboardRow = ReturnType<typeof computeDashboard>['orders'][number];

const PAGE_SIZE = 50;

function DashboardTable({ rows, canViewRawDebug }: { rows: DashboardRow[]; canViewRawDebug: boolean }) {
  const [page, setPage] = useState(1);
  const [rawOpenFor, setRawOpenFor] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>เลขออเดอร์</th><th>ลูกค้า</th><th style={{ textAlign: 'center' }}>รายการ</th><th>จำนวนสินค้า</th><th style={{ textAlign: 'right' }}>ยอดขายรวม</th>
            <th>การชำระ</th><th>ไทม์ไลน์</th><th>สถานะ</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((o) => (
            <Fragment key={o.orderUid}>
              <tr>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, fontSize: 12.5, whiteSpace: 'nowrap' }}>
                  {o.orderUid}<CopyButton value={o.orderUid} label="เลขคำสั่งซื้อ" />
                </td>
                <td>
                  {o.cust}<CopyButton value={o.cust} label="ชื่อลูกค้า" />
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{o.addr}</div>
                  {o.phone && (
                    <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', fontVariantNumeric: 'tabular-nums' }}>
                      {o.phone}<CopyButton value={o.phone} label="เบอร์โทร" />
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>{o.items}</td>
                <td style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{o.qtyText}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.amtText}</td>
                <td style={{ fontSize: 12 }}>
                  {o.paymentType}
                  <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>{o.paid}</div>
                  {o.codInfo && (
                    <div style={{ marginTop: 4 }}>
                      <span style={o.codInfo.style}>{o.codInfo.label}</span>
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 10.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {o.stages.length === 0 ? (
                    '—'
                  ) : (
                    o.stages.map((s) => (
                      <div key={s.label}>
                        <span style={{ color: 'var(--color-neutral-600)' }}>{s.label}:</span> {s.text}
                      </div>
                    ))
                  )}
                </td>
                <td><span style={o.stStyle}>{o.stLabel}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canViewRawDebug && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, marginRight: 6 }}
                      title="ดูข้อมูลดิบจาก Unii API (สำหรับตรวจสอบ field ที่ map ผิด)"
                      onClick={() => setRawOpenFor(rawOpenFor === o.orderUid ? null : o.orderUid)}
                    >
                      <i className="ph ph-code" />
                    </button>
                  )}
                  <button className="btn btn-ghost" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={o.viewItems}>ดูสินค้า</button>
                </td>
              </tr>
              {canViewRawDebug && rawOpenFor === o.orderUid && (
                <tr>
                  <td colSpan={9} style={{ padding: 0 }}>
                    <pre
                      style={{
                        margin: 0,
                        padding: 12,
                        fontSize: 11,
                        maxHeight: 320,
                        overflow: 'auto',
                        background: 'var(--color-surface)',
                        color: 'var(--color-neutral-300)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {JSON.stringify(o.raw ?? o, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '12px 0 6px' }}>
          <button className="btn btn-ghost" style={{ fontSize: 12.5 }} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            <i className="ph ph-caret-left" />ก่อนหน้า
          </button>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>หน้า {page} / {totalPages}</span>
          <button className="btn btn-ghost" style={{ fontSize: 12.5 }} disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
            หน้าถัดไป<i className="ph ph-caret-right" />
          </button>
        </div>
      )}
    </>
  );
}

export function DashboardPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const v = computeDashboard(state, actions);
  // Remounts the table (resetting to page 1) whenever a filter narrows/widens
  // the result set — otherwise switching status tabs could land on a now
  // out-of-range page from a previous, larger result set.
  const filterSignature = [state.statusFilter, state.q].join('|');

  return (
    <div>
      {v.apiOrdersLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--color-surface)', fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-circle-notch" style={{ animation: 'spin .8s linear infinite' }} />กำลังโหลดออเดอร์ใหม่จาก Google Sheet...
        </div>
      )}
      {v.apiOrdersError && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
          <i className="ph ph-warning-fill" style={{ flex: 'none' }} />โหลดออเดอร์ใหม่ไม่สำเร็จ: {v.apiOrdersError}
        </div>
      )}
      {!v.apiOrdersError && v.apiOrdersStale && (
        <div style={{ display: 'flex', gap: 9, padding: 13, marginBottom: 16, borderRadius: 10, background: 'var(--st-warn-bg, #fff7e0)', color: 'var(--st-warn-fg, #92700c)', fontSize: 13 }}>
          <i className="ph ph-warning" style={{ flex: 'none' }} />อ่านข้อมูลล่าสุดจาก Google Sheet ไม่สำเร็จ — กำลังแสดงข้อมูลที่แคชไว้ล่าสุดแทน (อาจไม่ใช่ข้อมูลปัจจุบันที่สุด)
        </div>
      )}

      <div className="seg" style={{ marginBottom: 16, width: 'fit-content' }}>
        <label className="seg-opt">
          <input type="radio" name="dashboardTab" checked={v.dashboardTab === 'overview'} onChange={() => v.setDashboardTab('overview')} /><i className="ph ph-squares-four" />ภาพรวม
        </label>
        <label className="seg-opt">
          <input type="radio" name="dashboardTab" checked={v.dashboardTab === 'calendar'} onChange={() => v.setDashboardTab('calendar')} /><i className="ph ph-calendar-blank" />ปฏิทินการจัดส่ง (Route Calendar)
        </label>
      </div>

      {v.dashboardTab === 'calendar' ? (
        <RouteCalendarPanel state={state} actions={actions} />
      ) : (
        <>
      <div className="card elev-sm" style={{ marginBottom: 22, gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}><i className="ph ph-calendar-check" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />พยากรณ์ 7 วันข้างหน้า</span>
          <select className="input" style={{ minHeight: 30, width: 200, marginLeft: 'auto', fontSize: 12.5 }} value={v.forecastStatusFilter} onChange={(e) => v.onForecastStatusFilter(e.target.value)}>
            <option value="all">ทุกสถานะ</option>
            {v.forecastStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
          {v.forecastDays.map((d) => (
            <div key={d.dayKey} style={{ padding: '10px 8px', borderRadius: 9, background: d.isToday ? 'var(--color-accent-900)' : 'var(--color-bg)', boxShadow: d.isToday ? 'inset 0 0 0 1px var(--color-accent-700)' : 'none', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--color-neutral-400)', marginBottom: 4 }}>{d.label}{d.isToday ? ' · วันนี้' : ''}</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 22, lineHeight: 1 }}>{d.count}</div>
              <div style={{ fontSize: 10, color: 'var(--color-neutral-500)', marginTop: 2 }}>ออเดอร์</div>
              {d.count === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--color-neutral-600)', marginTop: 6 }}>—</div>
              ) : d.fullyRouted ? (
                <div style={{ fontSize: 10, color: 'var(--st-ok-fg)', marginTop: 6 }}><i className="ph ph-check-circle-fill" style={{ marginRight: 3 }} />จัดรูทแล้ว</div>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--st-warn-fg)', marginTop: 6 }}><i className="ph ph-warning" style={{ marginRight: 3 }} />ยังไม่จัด {d.notRoutedCount}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
        {v.stats.map((s) => (
          <div className="card" key={s.label} style={{ gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="card-kicker" style={{ color: 'var(--color-neutral-400)' }}>{s.label}</span>
              <i className={s.icon} style={{ fontSize: 18, color: s.iconColor }} />
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 27, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 22 }}>
        <div className="card elev-sm" style={{ gap: 12 }}>
          <div className="card-kicker">ผลการดำเนินงานประจำวัน (Daily Performance)</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginBottom: 3 }}>Total Sales (วันนี้)</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 27, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{v.dailyPerformance.totalSalesText}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: v.dailyPerformance.salesChangeColor }}>{v.dailyPerformance.salesChangeText}</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', marginTop: 2 }}>เทียบกับเมื่อวาน</div>
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginBottom: 3 }}>ออเดอร์ค้างส่ง</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 27, lineHeight: 1, color: v.dailyPerformance.incompleteCount > 0 ? 'var(--st-bad-fg)' : undefined }}>
                {v.dailyPerformance.incompleteCount}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', marginTop: 2 }}>ออเดอร์ตกหล่น</div>
            </div>
          </div>
        </div>

        <div className="card elev-sm" style={{ gap: 12 }}>
          <div className="card-kicker">สถานะการดำเนินงาน (Operational Status)</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginBottom: 3 }}>ความพร้อมของรถขนส่ง</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 27, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {v.operationalStatus.fleetAvailable} / {v.operationalStatus.fleetTotal}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', marginTop: 2 }}>คันว่าง / รถทั้งหมด</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', marginBottom: 3 }}>ความจุคลังสินค้า</div>
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', maxWidth: 220 }}>
                <i className="ph ph-info" style={{ marginRight: 4 }} />ยังไม่มีข้อมูลความจุ/สต็อกคลังในระบบ — ข้ามการ์ดนี้ไว้ก่อน
              </div>
            </div>
          </div>
        </div>
      </div>

      {v.activeBatchCards.length > 0 && (
        <div className="card elev-sm" style={{ marginBottom: 22, gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            <i className="ph ph-truck" style={{ marginRight: 6, color: 'var(--color-accent-300)' }} />ชุดจัดส่ง (Batch) ที่กำลังทำงาน ({v.activeBatchCards.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {v.activeBatchCards.map((b) => (
              <div key={b.id} className="card" style={{ gap: 4, background: 'var(--color-bg)' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}><i className="ph ph-truck" style={{ marginRight: 5, color: 'var(--color-accent-300)' }} />{b.vehicleName}</div>
                <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', fontFamily: 'ui-monospace, monospace' }}>{b.id}</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>{b.orderCount} ออเดอร์ · {b.totalText}</div>
                <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)', marginTop: 2 }}>ออกจากคลัง {b.departedAtText}</div>
              </div>
            ))}
          </div>
          {v.activeBatchMapStops.length > 0 && (
            <div style={{ height: 320, borderRadius: 9, overflow: 'hidden', position: 'relative' }}>
              <RouteMap stops={v.activeBatchMapStops} warehouse={v.warehouseForBatches} />
            </div>
          )}
        </div>
      )}

      <div className="card elev-sm" style={{ marginBottom: 22, gap: 10, padding: '4px 14px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 2px 8px', fontWeight: 600, fontSize: 13.5 }}>
          <i className="ph ph-warning-fill" style={{ color: 'var(--st-bad-fg)' }} />
          ออเดอร์ค้างส่ง / ตกหล่น ({v.incompleteCount})
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={v.goToIncompleteOrders}>แสดงทั้งหมด<i className="ph ph-arrow-right" /></button>
        </div>
        {v.incompleteOrders.length === 0 ? (
          <div style={{ padding: 18, textAlign: 'center', color: 'var(--st-ok-fg)', fontSize: 12.5 }}>
            <i className="ph ph-check-circle-fill" style={{ marginRight: 5 }} />ไม่มีออเดอร์ตกหล่น
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>เลขคำสั่งซื้อ</th><th>ลูกค้า</th><th style={{ textAlign: 'center' }}>ล่าช้า</th><th>สถานะ</th><th></th></tr>
              </thead>
              <tbody>
                {v.incompleteOrders.slice(0, 10).map((o) => (
                  <tr key={o.orderNo}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                      {o.orderNo}<CopyButton value={o.orderNo} label="เลขคำสั่งซื้อ" />
                    </td>
                    <td>{o.customer}<CopyButton value={o.customer} label="ชื่อลูกค้า" /></td>
                    <td style={{ textAlign: 'center', fontSize: 12, color: 'var(--st-bad-fg)', fontWeight: 600 }}>{o.daysLate} วัน</td>
                    <td><span style={o.stStyle}>{o.stLabel}</span></td>
                    <td style={{ textAlign: 'right' }}><button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={o.viewItems}>ดูรายการสินค้า</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 340 }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="ค้นหาลูกค้า / เลขออเดอร์ / เบอร์โทร" value={v.q} onChange={(e) => v.onSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>{v.resultCount} รายการ</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {v.statusChips.map((c) => (
          <button key={c.key} style={c.style} onClick={c.go}>
            {c.label}<span style={{ opacity: 0.6, marginLeft: 6 }}>{c.count}</span>
          </button>
        ))}
      </div>

      <div className="card elev-sm" style={{ padding: '4px 14px 8px' }}>
        <DashboardTable key={filterSignature} rows={v.orders} canViewRawDebug={v.canViewRawDebug} />
        {v.noOrders && !v.apiOrdersLoading && (
          <div style={{ padding: 26, textAlign: 'center', color: 'var(--color-neutral-500)', fontSize: 12.5 }}>ไม่พบออเดอร์ที่ตรงกับตัวกรอง</div>
        )}
      </div>
        </>
      )}

      <OrderDetailModal state={state} actions={actions} />
    </div>
  );
}
