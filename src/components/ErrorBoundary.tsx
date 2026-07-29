import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render/lifecycle errors anywhere in the wrapped tree instead of
 * letting them unmount the whole app to a blank white screen (React's
 * default behavior with no error boundary in place — previously nothing in
 * this app caught render errors at all). Shows the actual error so a
 * real-data bug can be diagnosed from a screenshot instead of just "the app
 * is blank," and offers a reload.
 *
 * To recover when navigating away from whatever page crashed, render this
 * with `key={someRouteValue}` at the call site — changing the key remounts
 * a fresh boundary instance, which is React's own built-in way to reset a
 * component's state and needs no extra lifecycle code here. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render error caught by ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: 30, gap: 14, textAlign: 'center' }}>
          <i className="ph ph-warning-fill" style={{ fontSize: 40, color: 'var(--st-bad-fg)' }} />
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 17 }}>เกิดข้อผิดพลาดในการแสดงผลหน้านี้</div>
          <div
            style={{
              maxWidth: 560, fontSize: 12.5, fontFamily: 'ui-monospace, monospace', color: 'var(--color-neutral-400)',
              background: 'var(--color-surface)', borderRadius: 9, padding: 12, textAlign: 'left', overflowX: 'auto', whiteSpace: 'pre-wrap',
            }}
          >
            {this.state.error.message}
          </div>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            <i className="ph ph-arrows-clockwise" />โหลดหน้าใหม่
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
