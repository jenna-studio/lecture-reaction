import { useCallback, useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faQrcode, faCheck } from '@fortawesome/free-solid-svg-icons';
import { useSession } from '../lib/SessionContext';
import { hideLauncher, isDesktop, showOverlay } from '../lib/desktop';
import { fetchJoinBase, fetchSessionStatus, joinUrl } from '../lib/server';
import { QrCanvas } from '../components/QrCanvas';

/**
 * The small ordinary window: start the class, share the code, launch the
 * overlay. Once the overlay is up this window steps out of the way — and drops
 * its socket, so the server only ever holds one professor connection.
 */
export function Launcher() {
  const { state, startClass, disconnect, reset } = useSession();
  const [joinBase, setJoinBase] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const [ended, setEnded] = useState(false);
  const [starting, setStarting] = useState(false);

  // The QR must encode an address a phone can reach, which is the server's LAN
  // address — not localhost. Falls back to VITE_SERVER_URL's origin.
  useEffect(() => {
    const controller = new AbortController();
    void fetchJoinBase(controller.signal).then(setJoinBase);
    return () => controller.abort();
  }, []);

  // Handed off: no socket, so poll the server when this window comes back into
  // view to notice that the class was ended from the overlay.
  useEffect(() => {
    if (!handedOff || !state.code) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchSessionStatus(state.code as string).then((result) => {
        if (result && (!result.exists || result.status === 'ended')) {
          setHandedOff(false);
          setStarting(false);
          reset();
          setEnded(true);
        }
      });
    };
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [handedOff, state.code, reset]);

  const classEnded = ended || state.status === 'ended';

  const onCopy = useCallback(() => {
    if (!state.code) return;
    const text = joinBase ? joinUrl(joinBase, state.code) : state.code;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }, [joinBase, state.code]);

  const onStartOverlay = useCallback(() => {
    if (isDesktop()) {
      void showOverlay().then(() => hideLauncher());
    } else {
      // Browser review mode: the overlay is just another tab.
      window.open(`${window.location.pathname}?window=overlay`, '_blank', 'noopener');
    }
    setHandedOff(true);
    disconnect();
  }, [disconnect]);

  const onStart = useCallback(() => {
    setEnded(false);
    setStarting(true);
    startClass();
  }, [startClass]);

  return (
    <main className="h-full w-full flex flex-col items-center justify-center gap-5 px-6 text-center select-none">
      <h1 className="lr-pixel text-[15px] tracking-[0.22em]">LECTURE REACT</h1>

      {classEnded ? (
        <>
          <p className="lr-pixel text-[11px] text-[var(--lr-muted)]">CLASS ENDED</p>
          <button type="button" className="lr-btn lr-btn-primary lr-btn-lg" onClick={onStart}>
            [ START CLASS ]
          </button>
        </>
      ) : state.status !== 'active' ? (
        <>
          <button
            type="button"
            className="lr-btn lr-btn-primary lr-btn-lg"
            onClick={onStart}
            disabled={starting}
          >
            [ START CLASS ]
          </button>
          {starting && (
            <span className="lr-pixel text-[10px] text-[var(--lr-muted)] flex items-center gap-2">
              <span className="lr-loader">
                <i />
                <i />
                <i />
              </span>
              starting…
            </span>
          )}
          {state.lastError && (
            <p className="lr-text text-[11px] text-[var(--lr-muted)]">{state.lastError}</p>
          )}
        </>
      ) : (
        <>
          <div className="lr-code" aria-label={`Class code ${state.code ?? ''}`}>
            {state.code}
          </div>

          {showQr && joinBase && state.code ? (
            <QrCanvas value={joinUrl(joinBase, state.code)} />
          ) : (
            <div className="flex gap-2">
              <button type="button" className="lr-btn" onClick={onCopy}>
                <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="mr-2" />
                {copied ? 'Copied' : 'Copy Code'}
              </button>
              <button type="button" className="lr-btn" onClick={() => setShowQr(true)}>
                <FontAwesomeIcon icon={faQrcode} className="mr-2" />
                Show QR
              </button>
            </div>
          )}

          {showQr && (
            <button type="button" className="lr-btn lr-btn-ghost" onClick={() => setShowQr(false)}>
              Hide QR
            </button>
          )}

          <p className="lr-pixel text-[10px] text-[var(--lr-muted)]">
            {state.presence} student{state.presence === 1 ? '' : 's'} joined
          </p>

          <button type="button" className="lr-btn lr-btn-primary" onClick={onStartOverlay}>
            [ Start Overlay ]
          </button>
        </>
      )}
    </main>
  );
}
