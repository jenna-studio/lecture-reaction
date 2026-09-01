import type { QuestionView } from '@lr/shared';

interface Props {
  questions: QuestionView[];
  onVote: (questionId: string) => void;
}

export function QuestionList({ questions, onVote }: Props) {
  return (
    <section aria-labelledby="questions-heading">
      <h2 id="questions-heading" className="font-pixel text-[13px] text-lr-dark">
        Class Questions
      </h2>

      {questions.length === 0 ? (
        <p className="lr-text mt-2 text-[13px] text-lr-muted">
          No questions yet. Yours would be the first.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {questions.map((question) => (
            <QuestionRow key={question.id} question={question} onVote={onVote} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QuestionRow({ question, onVote }: { question: QuestionView; onVote: Props['onVote'] }) {
  const resolved = question.status === 'resolved';
  const locked = resolved || question.voted === true || question.mine === true;

  const voteLabel = resolved
    ? 'This question has been answered'
    : question.mine
      ? 'Your own question — you cannot vote for it'
      : question.voted
        ? `You already voted for this question. ${question.votes} votes`
        : `Upvote this question. ${question.votes} votes`;

  return (
    <li
      className={`lr-panel flex items-start gap-3 p-3 ${resolved ? 'lr-a-mint lr-resolved' : ''}`}
    >
      <button
        type="button"
        onClick={() => onVote(question.id)}
        disabled={locked}
        aria-label={voteLabel}
        aria-pressed={question.voted === true}
        className={`lr-btn flex min-h-[56px] w-14 shrink-0 flex-col items-center justify-center gap-1 px-0 ${
          question.voted || question.mine ? 'lr-a-lavender' : ''
        }`}
      >
        <span aria-hidden="true" className="text-[12px] leading-none">
          ▲
        </span>
        <span aria-hidden="true" className="font-pixel text-[13px] leading-none">
          {question.votes}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p className="lr-text text-[15px] leading-snug break-words text-lr-dark">{question.text}</p>
        {resolved && (
          <p className="mt-2 font-pixel text-[10px] text-lr-dark">✓ Answered</p>
        )}
        {!resolved && question.mine && (
          <p className="lr-text mt-1 text-[12px] text-lr-muted">Your question</p>
        )}
      </div>
    </li>
  );
}
