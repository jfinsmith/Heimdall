import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/** Below this we stop shrinking — a ~50-person roster would become illegible, so
 *  it's allowed to flow onto a second page instead. */
const MIN_ZOOM = 0.5;

/**
 * Shrinks its content just enough to fit one printed page. Uses CSS `zoom`
 * (layout-affecting, so print pagination respects it — unlike `transform: scale`,
 * which keeps the original box height and still breaks to a second page). Never
 * enlarges, never shrinks past MIN_ZOOM. Re-fits after fonts/logo load and again
 * right before printing, so the measurement reflects the final rendered height.
 *
 * `maxHeightIn` is the usable page height (letter minus margins); the default is
 * deliberately conservative so a sheet fits across common browser margin settings.
 */
export function FitToPage({ children, maxHeightIn = 9.7 }: { children: ReactNode; maxHeightIn?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.removeProperty('zoom');
      const natural = el.scrollHeight;
      const target = maxHeightIn * 96; // CSS px @ 96dpi
      if (natural > target) el.style.setProperty('zoom', String(Math.max(MIN_ZOOM, target / natural)));
    };
    fit();
    const t = setTimeout(fit, 250); // re-fit once the org logo / fonts settle
    window.addEventListener('beforeprint', fit);
    return () => { clearTimeout(t); window.removeEventListener('beforeprint', fit); };
  }, [maxHeightIn, children]);
  return <div ref={ref}>{children}</div>;
}
