import { useMemo } from 'react';
import { ConnectionDot } from '../components/ConnectionDot';
import { MessageStrip } from '../components/MessageStrip';
import { PollPanel } from '../components/PollPanel';
import { QuestionComposer } from '../components/QuestionComposer';
import { QuestionList } from '../components/QuestionList';
import { ReactionGrid } from '../components/ReactionGrid';
import { sortQuestions } from '../state/reducer';
import { useSession } from '../state/SessionProvider';

export function ReactScreen() {
  const { state, conn, leave, sendReaction, sendQuestion, voteQuestion, answerPoll } = useSession();
  const questions = useMemo(() => sortQuestions(state.questions), [state.questions]);
  const offline = conn !== 'open';
  const notice = state.notice ?? (offline ? { tone: 'info' as const, text: 'Reconnecting…' } : null);

  return (
    <div className="flex min-h-dvh flex-col bg-lr-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b-2 border-lr-dark bg-lr-bg px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-pixel text-[13px] text-lr-dark">CLASS {state.code}</span>
          <ConnectionDot conn={conn} />
        </div>
        <button type="button" className="lr-btn lr-btn-ghost border-2 px-3 py-2" onClick={leave}>
          Leave
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-6 px-4 pb-10">
        <MessageStrip notice={notice} />

        {state.poll && (
          <PollPanel poll={state.poll} answer={state.pollAnswer} onAnswer={answerPoll} />
        )}

        <section aria-labelledby="react-heading">
          <h1 id="react-heading" className="font-pixel text-[13px] text-lr-dark">
            How is the lecture going?
          </h1>
          <div className="mt-3">
            <ReactionGrid
              onSend={sendReaction}
              cooldownUntil={state.nextReactionAt}
              disabled={offline}
            />
          </div>
          <p className="lr-text mt-1 text-[12px] leading-snug text-lr-muted">
            You&rsquo;re anonymous — your professor sees reactions, never who sent them.
          </p>
        </section>

        <div className="lr-rule" />

        <QuestionComposer
          onSend={sendQuestion}
          cooldownUntil={state.nextQuestionAt}
          disabled={offline}
        />

        <QuestionList questions={questions} onVote={voteQuestion} />
      </main>
    </div>
  );
}
