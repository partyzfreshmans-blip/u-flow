import { useEffect, useRef, useState } from 'react';

// Chrome/Android exposes this natively; Safari/Firefox don't (yet) — feature
// -detect at call time rather than pulling in a JS decoding library (extra
// bundle weight, and a camera feed already runs fine without one where the
// API exists) just to cover the gap.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

const SUPPORTED = typeof window !== 'undefined' && !!window.BarcodeDetector;

/** Camera-scan button that sits next to a barcode text field: opens a live
 * preview, reads the first barcode it sees, and hands the digits back —
 * video never leaves the device, nothing is uploaded. On browsers without
 * the native BarcodeDetector API it renders disabled with an explanation
 * rather than failing silently or pulling in a fallback scanning library. */
export function BarcodeScanButton({ onDetect, title }: { onDetect: (value: string) => void; title?: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);

    const stop = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const detector = new window.BarcodeDetector!({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'],
        });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              const raw = codes[0].rawValue;
              onDetect(/^[0-9]+$/.test(raw) ? raw : raw.replace(/[^0-9]/g, '') || raw);
              cancelled = true;
              stop();
              setOpen(false);
              return;
            }
          } catch {
            // a transient decode failure on this frame — keep scanning
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — กรุณาอนุญาตแล้วลองใหม่'
            : 'เปิดกล้องไม่สำเร็จ',
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onDetect]);

  const close = () => setOpen(false);

  if (!SUPPORTED) {
    return (
      <button
        type="button"
        className="btn btn-icon btn-ghost"
        disabled
        title="เบราว์เซอร์นี้ไม่รองรับการแสกนบาร์โค้ดด้วยกล้อง — กรุณาพิมพ์เอง"
      >
        <i className="ph ph-barcode" style={{ fontSize: 15 }} />
      </button>
    );
  }

  return (
    <>
      <button type="button" className="btn btn-icon btn-ghost" onClick={() => setOpen(true)} title={title ?? 'แสกนบาร์โค้ดด้วยกล้อง'}>
        <i className="ph ph-barcode" style={{ fontSize: 15 }} />
      </button>
      {open && (
        <div className="dialog-backdrop" onClick={close}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(360px, 100%)' }}>
            <div className="dialog-title">แสกนบาร์โค้ด</div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {error ? (
                <div style={{ padding: 14, borderRadius: 9, background: 'var(--st-bad-bg)', color: 'var(--st-bad-fg)', fontSize: 13 }}>
                  <i className="ph ph-warning-fill" style={{ marginRight: 6 }} />{error}
                </div>
              ) : (
                <>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live camera preview, not recorded media */}
                  <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 9, background: '#000', aspectRatio: '4 / 3', objectFit: 'cover' }} />
                  <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', textAlign: 'center' }}>
                    เล็งกล้องไปที่บาร์โค้ด — ระบบจะกรอกให้อัตโนมัติเมื่อแสกนเจอ
                  </div>
                </>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={close}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
