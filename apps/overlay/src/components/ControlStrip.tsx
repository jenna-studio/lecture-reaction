import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChartSimple,
  faEye,
  faEyeSlash,
  faGear,
  faLink,
  faQrcode,
  faCheck,
  faQuestion,
  faRightFromBracket,
} from '@fortawesome/free-solid-svg-icons';
import type { ReactionZone } from '@lr/shared';
import type { ConnectionState } from '../lib/socket';
import type { OverlaySettings } from '../lib/settings';
import { clamp } from '../lib/spawn';
import { readJson, STORAGE_KEYS, writeJson } from '../lib/storage';
import { PollComposer } from './PollComposer';
import { Popup } from './Popup';
import { QrCanvas } from './QrCanvas';

type Popover = 'none' | 'settings' | 'end' | 'composer' | 'qr';

interface Point {
  x: number;
  y: number;
}

const STRIP_SIZE = { width: 420, height: 44 };
const LONG_PRESS_MS = 450;

function defaultPosition(): Point {
  // Bottom-left by default: the question stack owns the right edge.
  return { x: 24, y: Math.max(24, window.innerHeight - STRIP_SIZE.height - 24) };
}

export interface ControlStripProps {
  code: string | null;
  connection: ConnectionState;
  settings: OverlaySettings;
  onSettingsChange: (next: OverlaySettings) => void;
  /** Reactions received but not drawn, shown while Quiet Mode is on. */
  hiddenReactionCount: number;
  onAskClass: () => void;
  onCustomPoll: (question: string, options: string[]) => void;
  /** A poll is running but its panel is minimized. */
  pollMinimized: boolean;
  onExpandPoll: () => void;
  onEndClass: () => void;
  /** Full join URL (address + code) for the share controls. */
  shareUrl: string | null;
  /** Lets the overlay lift the poll panel clear of an open popover. */
  onPopoverToggle?: (open: boolean) => void;
}

/**
 * The professor's entire control surface: a draggable, collapsible strip.
 * Everything here is `data-lr-interactive`, which is what tells the
 * click-through hit-test to let the cursor land on the window.
 */
export function ControlStrip(props: ControlStripProps) {
  const { code, connection, settings, onSettingsChange } = props;

  const [position, setPosition] = useState<Point>(() =>
    readJson<Point>(STORAGE_KEYS.stripPosition, defaultPosition()),
  );
  const [collapsed, setCollapsed] = useState(() =>
    readJson<boolean>(STORAGE_KEYS.stripCollapsed, false),
  );
  const [popover, setPopover] = useState<Popover>('none');

  // The poll panel shares this corner; tell the overlay to lift it clear.
  const { onPopoverToggle } = props;
  useEffect(() => {
    onPopoverToggle?.(popover !== 'none');
  }, [popover, onPopoverToggle]);

  const rootRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<Point | null>(null);
  const longPress = useRef<number | undefined>(undefined);

  /* ---------------- dragging ---------------- */

  const clampToViewport = useCallback((p: Point): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    const w = rect?.width ?? STRIP_SIZE.width;
    const h = rect?.height ?? STRIP_SIZE.height;
    return {
      x: clamp(p.x, 8, window.innerWidth - w - 8),
      y: clamp(p.y, 8, window.innerHeight - h - 8),
    };
  }, []);

  useEffect(() => {
    // Also runs once on mount: a persisted position can be off-screen after
    // the professor plugs into a different projector.
    const onResize = () => setPosition((p) => clampToViewport(p));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampToViewport]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Grab the strip itself — never a control inside it.
    if ((event.target as HTMLElement).closest('button, input, label')) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const offset = dragOffset.current;
    if (!offset) return;
    setPosition(clampToViewport({ x: event.clientX - offset.x, y: event.clientY - offset.y }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    dragOffset.current = null;
    rootRef.current?.releasePointerCapture(event.pointerId);
    writeJson(STORAGE_KEYS.stripPosition, position);
  };

  /* ---------------- collapse ---------------- */

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      writeJson(STORAGE_KEYS.stripCollapsed, !prev);
      if (!prev) setPopover('none');
      return !prev;
    });
  };

  /* ---------------- ask class ---------------- */

  // Plain click = instant understanding check. Alt-click or long-press opens
  // the tiny custom-poll composer. There is deliberately no configuration step
  // on the common path.
  const askDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    longPress.current = window.setTimeout(() => {
      longPress.current = undefined;
      setPopover('composer');
    }, LONG_PRESS_MS);
  };

  const askUp = () => {
    if (longPress.current === undefined) return; // long-press already fired
    window.clearTimeout(longPress.current);
    longPress.current = undefined;
  };

  const askClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (popover === 'composer') return;
    if (event.altKey) {
      setPopover('composer');
      return;
    }
    setPopover('none');
    props.onAskClass();
  };

  useEffect(() => () => window.clearTimeout(longPress.current), []);

  const reconnecting = connection === 'reconnecting' || connection === 'connecting';

  return (
    <div
      ref={rootRef}
      data-lr-interactive="true"
      className="lr-panel-glass lr-interactive fixed z-40 flex items-center gap-2 px-2 py-1.5 cursor-grab active:cursor-grabbing"
      style={{ left: position.x, top: position.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <button
        type="button"
        data-lr-interactive="true"
        className="lr-btn lr-interactive px-2! py-1.5! text-[12px]!"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand controls' : 'Collapse controls'}
      >
        [ <span className="lr-mono tracking-[0.12em]">{code ?? '·····'}</span> ]
      </button>

      {!collapsed && (
        <>
          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
            onPointerDown={askDown}
            onPointerUp={askUp}
            onPointerLeave={askUp}
            onClick={askClick}
            title="Ask the class (alt-click or hold for a custom poll)"
          >
            <FontAwesomeIcon icon={faQuestion} className="mr-1.5" />
            Ask Class
          </button>

          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
            onClick={() =>
              onSettingsChange({ ...settings, quiet: !settings.quiet })
            }
            title={settings.quiet ? 'Show reactions' : 'Hide reactions (Quiet Mode)'}
          >
            <FontAwesomeIcon icon={settings.quiet ? faEyeSlash : faEye} className="mr-1.5" />
            Reactions
          </button>

          {settings.quiet && (
            <span className="lr-pixel text-[10px] text-[var(--lr-muted)] whitespace-nowrap">
              reactions hidden · {props.hiddenReactionCount}
            </span>
          )}

          {props.pollMinimized && (
            <button
              type="button"
              data-lr-interactive="true"
              className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
              onClick={props.onExpandPoll}
              title="Show poll results"
            >
              <FontAwesomeIcon icon={faChartSimple} />
            </button>
          )}

          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
            onClick={() => setPopover((p) => (p === 'settings' ? 'none' : 'settings'))}
            aria-label="Overlay settings"
          >
            <FontAwesomeIcon icon={faGear} />
          </button>

          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-btn-danger lr-interactive px-2! py-1.5! text-[11px]!"
            onClick={() => setPopover((p) => (p === 'end' ? 'none' : 'end'))}
          >
            <FontAwesomeIcon icon={faRightFromBracket} className="mr-1.5" />
            End Class
          </button>

          <ConnectionDot reconnecting={reconnecting} />
        </>
      )}

      {popover === 'settings' && (
        <SettingsPopover
          settings={settings}
          onChange={onSettingsChange}
          shareUrl={props.shareUrl}
          onShowQr={() => setPopover('qr')}
        />
      )}

      {popover === 'qr' && props.shareUrl && (
        <QrPopover url={props.shareUrl} onClose={() => setPopover('settings')} />
      )}

      {popover === 'end' && (
        <EndClassPopover
          onCancel={() => setPopover('none')}
          onConfirm={() => {
            setPopover('none');
            props.onEndClass();
          }}
        />
      )}

      {popover === 'composer' && (
        <PollComposer
          onCancel={() => setPopover('none')}
          onSubmit={(question, options) => {
            setPopover('none');
            props.onCustomPoll(question, options);
          }}
        />
      )}
    </div>
  );
}

function ConnectionDot({ reconnecting }: { reconnecting: boolean }) {
  if (reconnecting) {
    return (
      <span className="lr-pixel text-[10px] text-[var(--lr-muted)] flex items-center gap-1.5">
        <span className="lr-loader">
          <i />
          <i />
          <i />
        </span>
        reconnecting…
      </span>
    );
  }
  return (
    <span
      className="w-[8px] h-[8px] border-2 border-[var(--lr-dark)]"
      style={{ background: 'var(--lr-mint)' }}
      title="Connected"
      aria-label="Connected"
    />
  );
}

function SettingsPopover({
  settings,
  onChange,
  shareUrl,
  onShowQr,
}: {
  shareUrl: string | null;
  onShowQr: () => void;
  settings: OverlaySettings;
  onChange: (next: OverlaySettings) => void;
}) {
  const [copied, setCopied] = useState(false);

  const zones: { value: ReactionZone; label: string }[] = [
    { value: 'left', label: 'Left' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'both', label: 'Both' },
  ];

  return (
    <Popup>
      <p className="lr-pixel text-[10px] tracking-[0.1em] mb-1.5">REACTION POSITION</p>
      <div className="flex gap-3 mb-2">
        {zones.map((zone) => (
          <label key={zone.value} className="lr-text text-[12px] flex items-center gap-1.5">
            <input
              type="radio"
              name="lr-zone"
              data-lr-interactive="true"
              className="lr-interactive"
              checked={settings.zone === zone.value}
              onChange={() => onChange({ ...settings, zone: zone.value })}
            />
            {zone.label}
          </label>
        ))}
      </div>
      <div className="lr-rule mb-2" />
      <label className="lr-text text-[12px] flex items-center gap-2">
        <input
          type="checkbox"
          data-lr-interactive="true"
          className="lr-interactive"
          checked={settings.quiet}
          onChange={(e) => onChange({ ...settings, quiet: e.target.checked })}
        />
        Quiet Mode
      </label>

      {/* Latecomers are the reason this lives here: once the overlay is up the
          launcher is hidden, and the professor should not have to dig it out
          to re-share the link. */}
      <div className="lr-rule my-2" />
      <p className="lr-pixel text-[10px] tracking-[0.1em] mb-1.5">SHARE WITH CLASS</p>
      <div className="flex gap-2">
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
          disabled={!shareUrl}
          title={shareUrl ?? 'Working out the address students should use…'}
          onClick={() => {
            if (shareUrl) void navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          }}
        >
          <FontAwesomeIcon icon={copied ? faCheck : faLink} className="mr-1.5" />
          {copied ? 'Copied' : 'Copy Link'}
        </button>
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
          onClick={onShowQr}
        >
          <FontAwesomeIcon icon={faQrcode} className="mr-1.5" />
          Show QR
        </button>
      </div>
    </Popup>
  );
}

/**
 * The join QR, shown from the settings popover so a latecomer can be waved in
 * mid-lecture without leaving the overlay.
 */
function QrPopover({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <Popup>
      <div className="flex flex-col items-center gap-2">
        {/* QrCanvas prints the URL beneath itself, so no caption here. */}
        <QrCanvas value={url} />
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-btn-ghost lr-interactive px-2! py-1! text-[11px]!"
          onClick={onClose}
        >
          Back
        </button>
      </div>
    </Popup>
  );
}

function EndClassPopover({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Popup>
      <p className="lr-text text-[12px] leading-snug mb-2 max-w-[240px]">
        End this class? Students will no longer be able to send reactions or questions.
      </p>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-btn-danger lr-interactive px-2! py-1.5! text-[11px]!"
          onClick={onConfirm}
        >
          End Class
        </button>
      </div>
    </Popup>
  );
}
