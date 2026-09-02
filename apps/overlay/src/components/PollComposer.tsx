import { useState } from 'react';
import { Popup } from './Popup';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/**
 * Ten-second custom poll: one question, two to four options. Intentionally
 * cramped — the moment this grows fields it becomes a survey builder, and the
 * professor stops using it mid-lecture.
 */
export function PollComposer({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (question: string, options: string[]) => void;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const canSend = question.trim().length > 0 && filled.length >= MIN_OPTIONS;

  const setOption = (index: number, value: string) =>
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));

  return (
    <Popup>
      <p className="lr-pixel text-[10px] tracking-[0.1em] mb-1.5">QUICK POLL</p>

      <input
        data-lr-interactive="true"
        className="lr-interactive lr-text w-[240px] text-[12px] px-2 py-1 mb-1.5 border-2 border-[var(--lr-dark)] rounded-[3px] bg-[var(--lr-surface)]"
        placeholder="Question"
        value={question}
        maxLength={120}
        autoFocus
        onChange={(e) => setQuestion(e.target.value)}
      />

      {options.map((option, index) => (
        <input
          key={index}
          data-lr-interactive="true"
          className="lr-interactive lr-text w-[240px] text-[12px] px-2 py-1 mb-1 border-2 border-[var(--lr-dark)] rounded-[3px] bg-[var(--lr-surface)]"
          placeholder={`Option ${index + 1}`}
          value={option}
          maxLength={40}
          onChange={(e) => setOption(index, e.target.value)}
        />
      ))}

      <div className="flex items-center justify-between gap-2 mt-1.5">
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-btn-ghost lr-interactive px-1.5! py-1! text-[11px]!"
          disabled={options.length >= MAX_OPTIONS}
          onClick={() => setOptions((prev) => [...prev, ''])}
        >
          + option
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-interactive px-2! py-1! text-[11px]!"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-btn-primary lr-interactive px-2! py-1! text-[11px]!"
            disabled={!canSend}
            onClick={() => onSubmit(question.trim(), filled.slice(0, MAX_OPTIONS))}
          >
            Ask
          </button>
        </div>
      </div>
    </Popup>
  );
}
