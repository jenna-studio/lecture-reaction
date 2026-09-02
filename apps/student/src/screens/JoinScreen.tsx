import { useEffect, useRef, useState } from 'react';
import { isPlausibleCode, LIMITS, normalizeCode } from '@lr/shared';
import { CodeInput } from '../components/CodeInput';
import { MessageStrip } from '../components/MessageStrip';
import { getRememberedCode } from '../lib/storage';
import { useSession } from '../state/SessionProvider';
import type { Notice } from '../state/reducer';

/**
 * A code handed to us in the URL, e.g. `?c=K7M4P`.
 *
 * This is how the QR code and a pasted invite link work: the student should
 * land already joined, not on an empty form. Read once at module scope so a
 * re-render never re-triggers the auto-join.
 */
function codeFromUrl(): string {
  try {
    const raw = new URLSearchParams(window.location.search).get('c');
    return raw ? normalizeCode(raw).slice(0, LIMITS.codeLength) : '';
  } catch {
    return '';
  }
}

export function JoinScreen() {
  const { state, conn, join, clearNotice } = useSession();
  const [code, setCode] = useState(codeFromUrl);
  const [remembered] = useState(getRememberedCode);
  const autoJoined = useRef(false);

  // Arriving from a QR scan or an invite link: join immediately. Only ever
  // once — if the code turns out to be wrong the student stays on the form
  // with the error rather than being thrown into a retry loop.
  useEffect(() => {
    if (autoJoined.current) return;
    const fromUrl = codeFromUrl();
    if (!isPlausibleCode(fromUrl)) return;
    autoJoined.current = true;
    join(fromUrl);
    // Drop the query so a refresh (or a shared screenshot of the URL bar)
    // does not silently re-join a class the student has left.
    window.history.replaceState(null, '', window.location.pathname);
  }, [join]);

  const joining = state.phase === 'joining';
  const ready = isPlausibleCode(code);

  const notice: Notice | null =
    state.notice ?? (joining && conn !== 'open' ? { tone: 'info', text: 'Connecting…' } : null);

  const submit = () => {
    if (ready && !joining) join(code);
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <h1 className="text-center font-pixel text-[22px] leading-tight text-lr-dark">
          LECTURE
          <br />
          REACT
        </h1>
        <div className="lr-rule mx-auto mt-4 w-24" />

        <div className="lr-panel mt-6 p-5">
          <h2 className="text-center font-pixel text-[12px] text-lr-dark">Enter Class Code</h2>

          <div className="mt-4">
            <CodeInput
              value={code}
              onChange={(next) => {
                setCode(next);
                if (state.notice) clearNotice();
              }}
              onSubmit={submit}
              disabled={joining}
            />
          </div>

          <p id="code-hint" className="lr-text mt-3 text-center text-[12px] text-lr-muted">
            {LIMITS.codeLength} characters, shown on your lecturer&rsquo;s screen.
          </p>

          <button
            type="button"
            className="lr-btn lr-btn-primary lr-btn-lg mt-4 flex min-h-[56px] w-full items-center justify-center gap-2"
            onClick={submit}
            disabled={!ready || joining}
          >
            {joining ? (
              <>
                <span className="lr-loader" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                JOINING
              </>
            ) : (
              'JOIN'
            )}
          </button>

          <MessageStrip notice={notice} />
        </div>

        {remembered && !joining && (
          <button
            type="button"
            className="lr-btn lr-btn-ghost mt-4 w-full border-2"
            onClick={() => {
              setCode(remembered);
              join(remembered);
            }}
          >
            Rejoin {remembered}
          </button>
        )}

        <p className="lr-text mt-6 text-center text-[12px] text-lr-muted">
          You&rsquo;re anonymous. No sign-in, no name.
        </p>
      </div>
    </main>
  );
}
