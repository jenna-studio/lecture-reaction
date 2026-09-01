import { useState } from 'react';
import { LIMITS, normalizeCode } from '@lr/shared';

interface Props {
  value: string;
  onChange: (code: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

/**
 * One real input (so mobile keyboards, paste and autofill all behave) drawn as
 * five character boxes. Every keystroke goes through `normalizeCode`, which
 * drops the confusables that aren't in the code alphabet.
 */
export function CodeInput({ value, onChange, onSubmit, disabled }: Props) {
  const [focused, setFocused] = useState(false);
  const cells = Array.from({ length: LIMITS.codeLength }, (_, i) => value[i] ?? '');
  const caretAt = Math.min(value.length, LIMITS.codeLength - 1);

  return (
    <div className="relative">
      <div className="flex justify-center gap-2" aria-hidden="true">
        {cells.map((char, i) => {
          const isCaret = focused && !disabled && i === caretAt && value.length < LIMITS.codeLength;
          return (
            <span
              key={i}
              className={`flex h-16 w-12 items-center justify-center border-2 bg-lr-surface font-pixel text-[26px] text-lr-dark ${
                isCaret ? 'border-lr-dark shadow-[0_0_0_2px_var(--lr-lavender)]' : 'border-lr-dark'
              }`}
            >
              {char || (isCaret ? <span className="h-7 w-[2px] bg-lr-dark" /> : '')}
            </span>
          );
        })}
      </div>

      <input
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(normalizeCode(e.target.value).slice(0, LIMITS.codeLength))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={LIMITS.codeLength}
        aria-label={`Class code, ${LIMITS.codeLength} characters`}
        aria-describedby="code-hint"
      />
    </div>
  );
}
