/**
 * Small pure validators for user-supplied numeric config. Each returns
 * `undefined` for absent/invalid input so callers can fall back to a default
 * via `value ?? DEFAULT`. An explicit `0` is preserved (it is a valid value).
 */

/** Clamp to the inclusive range [0, 1]; undefined/NaN/Infinity → undefined. */
export function clamp01(v?: number): number | undefined {
    if (v == null || !Number.isFinite(v)) return undefined;
    return Math.min(1, Math.max(0, v));
}

/** Floor at 0; undefined/NaN/Infinity → undefined. */
export function nonNeg(v?: number): number | undefined {
    if (v == null || !Number.isFinite(v)) return undefined;
    return Math.max(0, v);
}
