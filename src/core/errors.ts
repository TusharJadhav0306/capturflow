import type { StartErrorCode } from '../types.js';

export interface ClassifiedError {
    code: StartErrorCode;
    recoverable: boolean;
    message: string;
}

/**
 * Map a thrown value from start()/getDisplayMedia/getUserMedia into a stable
 * error code consumers can branch on. Pure — unit-testable without a browser.
 *
 * All are reported recoverable: start() can be retried from the 'error' state
 * (e.g. the user can re-grant a denied permission).
 */
export function classifyStartError(err: unknown): ClassifiedError {
    const message = (err as any)?.message ?? String(err);
    const name = (err as any)?.name as string | undefined;

    // openPopupSync() rejects with a plain Error('Popup blocked').
    if (/popup blocked/i.test(message)) {
        return { code: 'POPUP_BLOCKED', recoverable: true, message };
    }

    switch (name) {
        case 'NotAllowedError':  return { code: 'PERMISSION_DENIED', recoverable: true, message };
        case 'NotFoundError':    return { code: 'NO_SOURCE',         recoverable: true, message };
        case 'NotReadableError': return { code: 'DEVICE_IN_USE',     recoverable: true, message };
        case 'AbortError':       return { code: 'ABORTED',           recoverable: true, message };
        default:                 return { code: 'START_FAILED',      recoverable: true, message };
    }
}
