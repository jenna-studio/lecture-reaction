/**
 * Session codes avoid O/0/I/1/L. Uniqueness among *active* sessions is the
 * caller's job — pass a predicate that knows which codes are taken.
 */
export declare function generateCode(isTaken?: (code: string) => boolean): string;
/** Normalizes user-typed codes: uppercase, strip noise, map confusables. */
export declare function normalizeCode(raw: string): string;
export declare function isPlausibleCode(code: string): boolean;
