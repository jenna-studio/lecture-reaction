import { useState } from 'react';
import { LIMITS } from '@lr/shared';
import { useCooldown, useSecondsLeft } from '../lib/hooks';

interface Props {
  onSend: (text: string) => void;
  /** Epoch ms before which a second question would be refused. */
  cooldownUntil: number;
  disabled: boolean;
}

/** Show the character budget only once it starts to matter. */
const COUNTER_THRESHOLD = 40;

export function QuestionComposer({ onSend, cooldownUntil, disabled }: Props) {
  const [text, setText] = useState('');
  const cooling = useCooldown(cooldownUntil);
  const secondsLeft = useSecondsLeft(cooldownUntil);
  const remaining = LIMITS.questionMaxChars - text.length;
  const canSend = text.trim().length > 0 && !cooling && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(text);
    setText('');
  };

  return (
    <section aria-labelledby="ask-heading">
      <h2 id="ask-heading" className="font-pixel text-[13px] text-lr-dark">
        Ask a question
      </h2>

      <textarea
        className="lr-text mt-2 block h-24 w-full resize-none border-2 border-lr-dark bg-lr-surface p-3 text-[15px] leading-snug text-lr-dark shadow-[var(--lr-shadow-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lr-lavender"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={LIMITS.questionMaxChars}
        placeholder="Anything you'd like explained…"
        aria-label="Your question"
        aria-describedby="ask-status"
        disabled={disabled}
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <p id="ask-status" className="lr-text text-[12px] text-lr-muted" aria-live="polite">
          {cooling
            ? `You can ask again in ${secondsLeft}s`
            : remaining < COUNTER_THRESHOLD
              ? `${remaining} characters left`
              : ''}
        </p>
        <button type="button" className="lr-btn lr-btn-primary" onClick={submit} disabled={!canSend}>
          Send
        </button>
      </div>
    </section>
  );
}
