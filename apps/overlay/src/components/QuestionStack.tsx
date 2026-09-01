import { useEffect, type CSSProperties } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { LIMITS } from '@lr/shared';
import { useSession } from '../lib/SessionContext';
import { selectQuestionStack, type QuestionCard } from '../lib/sessionState';

/** Above this many votes a card gets the yellow "the room wants this" tint. */
const HOT_VOTES = 10;

/**
 * Right-edge question stack. Newest sits at the BOTTOM — that is where the
 * professor's eye rests — with older cards pushed up and the overflow
 * collapsed into a single chip rather than a scroller.
 */
export function QuestionStack() {
  const { state, resolveQuestion, dropQuestion } = useSession();
  const { cards, overflow } = selectQuestionStack(state);

  // Cards animate out optimistically; this is the cleanup after the fade.
  const exitingIds = cards.filter((c) => c.exiting).map((c) => c.id);
  const exitingKey = exitingIds.join(',');
  useEffect(() => {
    if (exitingIds.length === 0) return;
    const timers = exitingIds.map((id) =>
      window.setTimeout(() => dropQuestion(id), LIMITS.resolveFadeMs),
    );
    return () => timers.forEach(window.clearTimeout);
    // Deps are the *identity* of the exiting set, not the array instance.
  }, [exitingKey, dropQuestion]);

  if (cards.length === 0 && overflow === 0) return null;

  return (
    <section
      className="fixed right-4 top-4 bottom-24 z-20 flex flex-col justify-end items-stretch gap-2 w-[320px] max-w-[26vw]"
      aria-label="Student questions"
    >
      {overflow > 0 && (
        <div className="lr-panel-glass lr-pixel self-end px-2 py-1 text-[10px] text-[var(--lr-muted)]">
          +{overflow} more
        </div>
      )}
      {cards.map((card) => (
        <Card key={card.id} card={card} onResolve={() => resolveQuestion(card.id)} />
      ))}
    </section>
  );
}

function Card({ card, onResolve }: { card: QuestionCard; onResolve: () => void }) {
  const hot = card.votes >= HOT_VOTES;

  return (
    <article
      data-lr-interactive="true"
      className={`lr-panel-glass lr-interactive relative px-3 pt-2 pb-2 ${
        card.exiting ? 'lr-card-exit' : 'lr-card-enter'
      }`}
      style={{
        borderColor: hot ? 'var(--lr-dark)' : undefined,
        background: hot
          ? 'color-mix(in srgb, var(--lr-yellow) 42%, color-mix(in srgb, var(--lr-bg) 82%, transparent))'
          : undefined,
        '--lr-exit-ms': `${LIMITS.resolveFadeMs}ms`,
      } as CSSProperties}
    >
      <span
        className={`lr-pixel block leading-none ${hot ? 'text-[13px]' : 'text-[11px]'}`}
        aria-label={`${card.votes} votes`}
      >
        ▲ {card.votes}
      </span>

      <p className="lr-text lr-clamp-4 mt-1 text-[13px] leading-[1.35] pr-6">{card.text}</p>

      <button
        type="button"
        data-lr-interactive="true"
        className="lr-btn lr-interactive absolute bottom-2 right-2 !px-2 !py-1"
        aria-label="Mark question resolved"
        onClick={onResolve}
        disabled={card.exiting}
      >
        <FontAwesomeIcon icon={faCheck} />
      </button>
    </article>
  );
}
