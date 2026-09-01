import type { CSSProperties } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faMinus } from '@fortawesome/free-solid-svg-icons';
import { UNDERSTANDING_OPTIONS, type PaletteKey, type PollResultsView } from '@lr/shared';
import { ACCENT_VAR } from '../lib/icons';

/** Understanding always reads mint → yellow → pink, best to worst. */
const UNDERSTANDING_ACCENT: Record<string, PaletteKey> = {
  got_it: 'mint',
  almost: 'yellow',
  lost: 'pink',
};

const CUSTOM_ACCENTS: PaletteKey[] = ['sky', 'lavender', 'mint', 'yellow'];

interface Row {
  id: string;
  label: string;
  pct: number;
  accent: PaletteKey;
}

function rowsFor(results: PollResultsView): Row[] {
  const byId = new Map(results.results.map((r) => [r.optionId, r]));

  if (results.kind === 'understanding') {
    // Always show all three, in a fixed order, even before anyone answers —
    // a jumping row order is unreadable mid-sentence.
    return UNDERSTANDING_OPTIONS.map((opt) => ({
      id: opt.id,
      label: opt.label,
      pct: byId.get(opt.id)?.pct ?? 0,
      accent: UNDERSTANDING_ACCENT[opt.id] ?? 'sky',
    }));
  }

  return results.results.map((r, i) => ({
    id: r.optionId,
    label: r.label,
    pct: r.pct,
    accent: CUSTOM_ACCENTS[i % CUSTOM_ACCENTS.length],
  }));
}

/**
 * Compact results panel. Bars animate their width — the nodes are never
 * remounted — so incoming answers glide instead of flickering.
 */
export function PollPanel({
  results,
  onMinimize,
  onClose,
}: {
  results: PollResultsView;
  onMinimize: () => void;
  onClose: () => void;
}) {
  const rows = rowsFor(results);
  const title = results.kind === 'understanding' ? 'UNDERSTANDING' : results.question;

  return (
    <section
      data-lr-interactive="true"
      className="lr-panel-glass lr-interactive fixed z-30 bottom-24 left-6 w-[300px] px-3 py-2"
      aria-label="Poll results"
    >
      <header className="flex items-start justify-between gap-2">
        <h2 className="lr-pixel text-[10px] tracking-[0.12em] uppercase pr-2">{title}</h2>
        <div className="flex gap-1">
          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-btn-ghost lr-interactive !p-1 !text-[10px]"
            aria-label="Minimize results"
            onClick={onMinimize}
          >
            <FontAwesomeIcon icon={faMinus} />
          </button>
          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-btn-ghost lr-interactive !p-1 !text-[10px]"
            aria-label="End poll"
            onClick={onClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      </header>

      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <span className="lr-text text-[11px] w-[54px] shrink-0">{row.label}</span>
            <span className="lr-pixel text-[11px] w-[34px] shrink-0 text-right">{row.pct}%</span>
            <span className="lr-bar-track grow">
              <span
                className="lr-bar-fill block"
                style={
                  {
                    width: `${Math.max(0, Math.min(100, row.pct))}%`,
                    '--lr-bar-accent': ACCENT_VAR[row.accent],
                  } as CSSProperties
                }
              />
            </span>
          </li>
        ))}
      </ul>

      <p className="lr-pixel text-[10px] text-[var(--lr-muted)] mt-2">(n={results.total})</p>
    </section>
  );
}
