import { useEffect, useState } from 'react';

/**
 * Modern, sleek loading screen.
 *
 * - Pure clean background matching the active theme (dark: #202A2F, light: #EBE7DC).
 * - Logo prominently centered.
 * - Horizontal track with a small filled segment that sweeps:
 *     left → right → (immediately) right → left → pause → left → right → back quickly → repeat
 * - When `completing` becomes true, the indeterminate motion is "scratched" and
 *   the bar fills to 100% quickly (determinate completion).
 * - Adaptive to dark/light mode via CSS variables / data-theme.
 */
export function LoadingScreen({
  theme = 'dark',
  completing = false,
  label,
  inline = false,
}: {
  theme?: 'dark' | 'light';
  completing?: boolean;
  label?: string;
  inline?: boolean;
}) {
  const [show, setShow] = useState(true);

  // Hide after completion animation finishes.
  useEffect(() => {
    if (!completing) return;
    const t = setTimeout(() => setShow(false), 420);
    return () => clearTimeout(t);
  }, [completing]);

  if (!show) return null;

  return (
    <div
      className={`loading-screen ${inline ? 'is-inline' : ''} ${completing ? 'is-completing' : ''}`}
      data-theme={theme}
      role="status"
      aria-live="polite"
      aria-label={label || 'Loading'}
    >
      <div className="loading-logo">
        <img src="/ledger-ai-mark.svg" alt="" />
      </div>
      <div className="loading-track" aria-hidden="true">
        <span className="loading-fill" />
      </div>
      {label && <div className="loading-label">{label}</div>}
    </div>
  );
}

export default LoadingScreen;
