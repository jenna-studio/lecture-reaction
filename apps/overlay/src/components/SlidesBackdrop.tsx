/**
 * Browser-review only. In the desktop app the overlay is genuinely
 * transparent and the professor's slides show through; in a plain browser
 * there is nothing underneath, so we paint a dark stand-in slide to judge
 * legibility and contrast.
 */
export function SlidesBackdrop() {
  return (
    <div className="lr-fake-slides flex flex-col items-center justify-center gap-4 select-none">
      <p className="lr-pixel text-[13px] tracking-[0.2em] opacity-70">SLIDE 14 / 32</p>
      <p className="lr-text text-[34px] font-medium opacity-90">Gradient Descent</p>
      <p className="lr-text text-[15px] opacity-55 max-w-[560px] text-center">
        Placeholder for the professor&apos;s presentation. The real overlay is transparent —
        this only exists so the layout can be reviewed in a browser.
      </p>
    </div>
  );
}
