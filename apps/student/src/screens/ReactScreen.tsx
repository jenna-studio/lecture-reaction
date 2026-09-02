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
      <header className="sticky top-0 z-10 border-b-2 border-lr-dark bg-lr-bg">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-3 lg:max-w-5xl lg:px-8">
          <div className="flex items-center gap-2">
            <span className="font-pixel text-[13px] text-lr-dark lg:text-[15px]">
              CLASS{' '}
              <span className="lr-mono tracking-[0.14em]">{state.code}</span>
            </span>
            <ConnectionDot conn={conn} />
          </div>
          <button type="button" className="lr-btn lr-btn-ghost border-2 px-3 py-2" onClick={leave}>
            Leave
          </button>
        </div>
      </header>

      {/*
        One column on a phone (the primary case), two on a laptop: reacting on
        the left, the class's questions alongside instead of far below the fold.
        The reaction grid keeps its 3x2 shape at every width — it is the thing
        students aim at without looking, so its geometry should not move.
      */}
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-10 lg:max-w-5xl lg:px-8">
        <div className="flex flex-col gap-4 pt-4">
          <MessageStrip notice={notice} />

          {state.poll && (
            <PollPanel poll={state.poll} answer={state.pollAnswer} onAnswer={answerPoll} />
          )}
        </div>

        <div className="mt-2 flex flex-col gap-6 lg:mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start lg:gap-10">
          <div className="flex flex-col gap-6">
            <section aria-labelledby="react-heading">
              <h1 id="react-heading" className="font-pixel text-[13px] text-lr-dark lg:text-[15px]">
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

            <div className="lr-rule lg:hidden" />

            <QuestionComposer
              onSend={sendQuestion}
              cooldownUntil={state.nextQuestionAt}
              disabled={offline}
            />
          </div>

          {/* Sticky on a laptop so the list stays put while the page scrolls. */}
          <div className="lg:sticky lg:top-24">
            <QuestionList questions={questions} onVote={voteQuestion} />
          </div>
        </div>
      </main>
    </div>
  );
}
