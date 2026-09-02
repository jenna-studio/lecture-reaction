import type { ReactNode } from 'react';

/**
 * A tiny popover anchored above the control strip. Deliberately NOT a dialog:
 * nothing on the overlay may take over the screen while the professor talks.
 */
export function Popup({ children }: { children: ReactNode }) {
  return (
    <div
      data-lr-interactive="true"
      className="lr-panel-glass lr-interactive absolute bottom-[calc(100%+8px)] left-0 px-3 py-2 min-w-[220px] z-50"
    >
      {children}
    </div>
  );
}
