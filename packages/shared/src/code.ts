import { LIMITS } from './protocol.js';

/**
 * Session codes avoid O/0/I/1/L. Uniqueness among *active* sessions is the
 * caller's job — pass a predicate that knows which codes are taken.
 */
export function generateCode(isTaken: (code: string) => boolean = () => false): string {
  const { codeAlphabet: A, codeLength: N } = LIMITS;
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < N; i++) code += A[Math.floor(Math.random() * A.length)];
    if (!isTaken(code)) return code;
  }
  // Astronomically unlikely; widen rather than fail a class start.
  let code = '';
  for (let i = 0; i < N + 1; i++) code += A[Math.floor(Math.random() * A.length)];
  return code;
}

/** Normalizes user-typed codes: uppercase, strip noise, map confusables. */
export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0').replace(/0/g, '')   // O and 0 are not in the alphabet
    .replace(/[IL1]/g, '')                  // nor are I, L, 1
    .slice(0, LIMITS.codeLength + 1);
}

export function isPlausibleCode(code: string): boolean {
  const A = LIMITS.codeAlphabet;
  return code.length >= LIMITS.codeLength && [...code].every((c) => A.includes(c));
}
