import type { ConnState } from '../lib/socket';

const DOT: Record<ConnState, { color: string; label: string }> = {
  open: { color: '#3F9D5B', label: 'Connected' },
  connecting: { color: '#D8A200', label: 'Connecting' },
  reconnecting: { color: '#D8A200', label: 'Reconnecting' },
  closed: { color: '#C4442F', label: 'Disconnected' },
};

export function ConnectionDot({ conn }: { conn: ConnState }) {
  const { color, label } = DOT[conn];
  return (
    <span className="flex items-center gap-1.5" title={label}>
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 border-2 border-lr-dark"
        style={{ background: color }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
