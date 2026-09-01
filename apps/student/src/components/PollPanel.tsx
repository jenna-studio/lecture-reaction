import { UNDERSTANDING_OPTIONS, type PollOptionView, type PollView } from '@lr/shared';

interface Props {
  poll: PollView;
  answer: string | null;
  onAnswer: (optionId: string) => void;
}

/**
 * Slides in above the reactions and pushes them down — never covers them, and
 * never becomes a modal the student has to dismiss.
 */
export function PollPanel({ poll, answer, onAnswer }: Props) {
  // An understanding check is defined by the shared contract, so it stays
  // answerable even if the server sends the poll without spelling options out.
  const options: readonly PollOptionView[] =
    poll.options.length > 0
      ? poll.options
      : poll.kind === 'understanding'
        ? UNDERSTANDING_OPTIONS
        : [];

  return (
    <section
      className="lr-panel lr-slide-down lr-a-yellow p-4"
      aria-labelledby="poll-question"
      aria-live="polite"
    >
      <p className="font-pixel text-[10px] text-lr-dark">
        {poll.kind === 'understanding' ? 'Understanding check' : 'Quick poll'}
      </p>
      <h2 id="poll-question" className="lr-text mt-2 text-[16px] leading-snug font-semibold text-lr-dark">
        {poll.question}
      </h2>

      <div className="mt-3 flex flex-col gap-2">
        {options.map((option) => {
          const selected = answer === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onAnswer(option.id)}
              aria-pressed={selected}
              className={`lr-btn lr-btn-lg min-h-[56px] w-full text-left ${
                selected ? 'lr-a-mint' : ''
              }`}
            >
              {selected ? `✓ ${option.label}` : option.label}
            </button>
          );
        })}
      </div>

      {answer && (
        <p className="lr-text mt-3 text-[12px] text-lr-muted">You can change your answer.</p>
      )}
    </section>
  );
}
