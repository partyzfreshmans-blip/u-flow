import { useState } from 'react';

/** Small inline "copy to clipboard" button that sits right next to a value —
 * เลขคำสั่งซื้อ, ชื่อลูกค้า, เบอร์โทร — wherever it's displayed as read-only
 * text, so staff can grab it (to paste into LINE, a courier app, a search
 * box) without hand-selecting text in a dense table or on a touchscreen.
 * Renders nothing for an empty value rather than an unusable copy button. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value || !value.trim()) return null;

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable (e.g. non-HTTPS context) — fall back to
      // the old hidden-textarea + execCommand trick rather than doing
      // nothing.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        // Nothing left to try — the click is silently a no-op.
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      className="btn btn-icon btn-ghost"
      style={{ width: 20, height: 20, minWidth: 20, verticalAlign: 'middle', marginLeft: 4, flex: 'none' }}
      onClick={onCopy}
      title={copied ? 'คัดลอกแล้ว' : label ? `คัดลอก${label}` : 'คัดลอก'}
    >
      <i className={copied ? 'ph ph-check' : 'ph ph-copy'} style={{ fontSize: 11, color: copied ? 'var(--st-ok-fg)' : undefined }} />
    </button>
  );
}
