import { useCallback, useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faQrcode, faCheck, faLink } from '@fortawesome/free-solid-svg-icons';
import { useSession } from '../lib/SessionContext';
import { hideLauncher, isDesktop, showOverlay } from '../lib/desktop';
import { fetchJoinBase, fetchSessionStatus, joinUrl } from '../lib/server';
import { QrCanvas } from '../components/QrCanvas';

/**
 * How often the launcher re-asks the server which address students should use.
 * Cheap (a local request) and worth it: a professor who joins the room's Wi-Fi
 * after opening the app would otherwise show the class a dead QR code.
 */
const JOIN_URL_POLL_MS = 10_000;

/**
 * The small ordinary window: start the class, share the code, launch the
 * overlay. Once the overlay is up this window steps out of the way — and drops
 * its socket, so the server only ever holds one professor connection.
 */
export function Launcher() {
  const { state, startClass, disconnect, reset } = useSession();
  const [joinBase, setJoinBase] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [handedOff, setHandedOff] = useState(false);
  const [ended, setEnded] = useState(false);
  const [starting, setStarting] = useState(false);

  // The QR must encode an address a phone can reach, which is the server's LAN
  // address — not localhost. Falls back to VITE_SERVER_URL's origin.
  //
  // Re-checked continuously rather than once on mount: the professor often
  // opens the app in an office and only joins the lecture hall's Wi-Fi on the
  // way in, which changes the address students need. Polling keeps the QR and
  // the printed URL correct without anyone restarting anything.
  useEffect(() => {
    let controller = new AbortController();
    let timer: number | undefined;

    const refresh = () => {
      controller.abort();
      controller = new AbortController();
      void fetchJoinBase(controller.signal).then(setJoinBase);
    };

    refresh();
    timer = window.setInterval(refresh, JOIN_URL_POLL_MS);

    // A network change shows up immediately rather than on the next tick.
    const onOnline = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Handed off: no socket, so poll the server when this window comes back into
  // view to notice that the class was ended from the overlay.
  useEffect(() => {
    const code = state.code;
    if (!handedOff || !code) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchSessionStatus(code).then((result) => {
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

  const copyText = useCallback((text: string, which: 'link' | 'code') => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(which);
    window.setTimeout(() => setCopied(null), 1400);
  }, []);

  /** The full invite: address + code, so a student needs only to click it. */
  const shareUrl = joinBase && state.code ? joinUrl(joinBase, state.code) : null;

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
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  className="lr-btn"
                  onClick={() => shareUrl && copyText(shareUrl, 'link')}
                  disabled={!shareUrl}
                  title={shareUrl ?? 'Working out the address students should use…'}
                >
                  <FontAwesomeIcon icon={copied === 'link' ? faCheck : faLink} className="mr-2" />
                  {copied === 'link' ? 'Copied' : 'Copy Link'}
                </button>
                <button
                  type="button"
                  className="lr-btn"
                  onClick={() => state.code && copyText(state.code, 'code')}
                >
                  <FontAwesomeIcon icon={copied === 'code' ? faCheck : faCopy} className="mr-2" />
                  {copied === 'code' ? 'Copied' : 'Copy Code'}
                </button>
                <button type="button" className="lr-btn" onClick={() => setShowQr(true)}>
                  <FontAwesomeIcon icon={faQrcode} className="mr-2" />
                  Show QR
                </button>
              </div>

              {/* Shown so it is obvious what "Copy Link" put on the clipboard,
                  and so the address can be read out if someone cannot scan. */}
              {shareUrl && (
                <p className="lr-text max-w-[300px] break-all text-[10px] text-[var(--lr-muted)]">
                  {shareUrl}
                </p>
              )}
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
