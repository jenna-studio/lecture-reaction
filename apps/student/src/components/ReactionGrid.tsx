import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  FAULT_TYPES,
  REACTION_META,
  REACTION_TYPES,
  isFaultType,
  type ReactionType,
} from '@lr/shared';
import { accentClass, reactionIcon } from '../lib/icons';
import { useCooldown } from '../lib/hooks';

interface Props {
  onSend: (type: ReactionType) => void;
  /** Epoch ms; until then every reaction button is cooling down together. */
  cooldownUntil: number;
  disabled: boolean;
}

const SENT_PILL_MS = 1100;

/** The 3x2 feelings grid; the fault reports are rendered separately below it. */
const SENTIMENT_TYPES = REACTION_TYPES.filter((t) => !isFaultType(t));

export function ReactionGrid({ onSend, cooldownUntil, disabled }: Props) {
  const cooling = useCooldown(cooldownUntil);
  const [sent, setSent] = useState<{ label: string; key: number } | null>(null);
  const blocked = cooling || disabled;

  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(null), SENT_PILL_MS);
    return () => clearTimeout(id);
  }, [sent]);

  const handle = (type: ReactionType) => {
    if (blocked) return;
    onSend(type);
    setSent({ label: REACTION_META[type].label, key: Date.now() });
  };

  // Remaining time drives the CSS fill, so a server-corrected deadline is honoured.
  const remainingMs = Math.max(0, cooldownUntil - Date.now());

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {SENTIMENT_TYPES.map((type) => {
          const meta = REACTION_META[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => handle(type)}
              disabled={blocked}
              aria-label={meta.meaning}
              className={`lr-btn relative flex min-h-[92px] flex-col items-center justify-center gap-2 overflow-hidden px-1 py-3 lg:min-h-[104px] ${accentClass(
                meta.accent,
              )} ${cooling && !disabled ? 'lr-cooling' : ''}`}
            >
              <FontAwesomeIcon
                icon={reactionIcon(type)}
                className="text-[26px] lg:text-[30px]"
                aria-hidden="true"
              />
              <span className="font-pixel text-[10px] leading-tight text-lr-dark">{meta.label}</span>
              {cooling && (
                <span
                  key={cooldownUntil}
                  aria-hidden="true"
                  className="lr-cooldown"
                  style={{ animationDuration: `${remainingMs}ms` }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/*
        Faults, not feelings: a dead mic and a washed-out projector are separate
        problems with separate fixes, so they are separate buttons — sitting
        apart from the sentiment grid on their own row.
      */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {FAULT_TYPES.map((type) => {
          const meta = REACTION_META[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => handle(type)}
              disabled={blocked}
              aria-label={meta.meaning}
              className={`lr-btn relative flex min-h-[56px] items-center justify-center gap-2 overflow-hidden px-2 ${accentClass(
                meta.accent,
              )} ${cooling && !disabled ? 'lr-cooling' : ''}`}
            >
              <FontAwesomeIcon
                icon={reactionIcon(type)}
                className="text-[20px] lg:text-[22px]"
                aria-hidden="true"
              />
              <span className="font-pixel text-[10px] leading-tight text-lr-dark">
                {meta.label}
              </span>
              {cooling && (
                <span
                  key={`${type}-${cooldownUntil}`}
                  aria-hidden="true"
                  className="lr-cooldown"
                  style={{ animationDuration: `${remainingMs}ms` }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div role="status" aria-live="polite" className="mt-2 flex h-6 items-center justify-center">
        {sent && (
          <span
            key={sent.key}
            className="lr-fade-out lr-a-mint border-2 border-lr-dark px-2 py-1 font-pixel text-[10px] text-lr-dark"
          >
            Sent · {sent.label}
          </span>
        )}
      </div>
    </div>
  );
}
