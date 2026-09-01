import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

/**
 * The QR is rendered locally — the join URL never leaves the machine, and the
 * launcher works on a lecture-hall network with no internet.
 */
export function QrCanvas({ value, size = 148 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      color: { dark: '#282828', light: '#F7F6F1' },
    })
      .then(() => !cancelled && setFailed(false))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="border-2 border-[var(--lr-dark)] rounded-[3px]"
      />
      <span className="lr-text text-[10px] text-[var(--lr-muted)] break-all text-center max-w-[220px]">
        {failed ? 'QR unavailable — type the URL' : value}
      </span>
    </div>
  );
}
