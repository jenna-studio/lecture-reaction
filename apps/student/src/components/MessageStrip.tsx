import type { Notice } from '../state/reducer';

/**
 * The app's only way of saying something went wrong. Never a dialog — a strip
 * under whatever the student was doing.
 */
export function MessageStrip({ notice }: { notice: Notice | null }) {
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {notice && (
        <p
          className={`lr-text mt-3 border-2 border-lr-dark px-3 py-2 text-[13px] leading-snug text-lr-dark ${
            notice.tone === 'error' ? 'lr-a-pink' : 'lr-a-yellow'
          }`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
