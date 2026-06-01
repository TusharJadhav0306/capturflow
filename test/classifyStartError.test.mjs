// Unit tests for the start() error classifier — pure, no browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStartError } from '../dist/index.esm.js';

const ex = (name, message = 'x') => ({ name, message }); // DOMException-like

test('NotAllowedError → PERMISSION_DENIED (recoverable)', () => {
    const r = classifyStartError(ex('NotAllowedError', 'denied'));
    assert.equal(r.code, 'PERMISSION_DENIED');
    assert.equal(r.recoverable, true);
    assert.equal(r.message, 'denied');
});

test('NotFoundError → NO_SOURCE', () => {
    assert.equal(classifyStartError(ex('NotFoundError')).code, 'NO_SOURCE');
});

test('NotReadableError → DEVICE_IN_USE', () => {
    assert.equal(classifyStartError(ex('NotReadableError')).code, 'DEVICE_IN_USE');
});

test('AbortError → ABORTED', () => {
    assert.equal(classifyStartError(ex('AbortError')).code, 'ABORTED');
});

test('InvalidStateError / InvalidAccessError → NO_USER_GESTURE (lost activation)', () => {
    assert.equal(classifyStartError(ex('InvalidStateError')).code, 'NO_USER_GESTURE');
    assert.equal(classifyStartError(ex('InvalidAccessError')).code, 'NO_USER_GESTURE');
});

test('Popup blocked message → POPUP_BLOCKED (regardless of name)', () => {
    assert.equal(classifyStartError(new Error('Popup blocked')).code, 'POPUP_BLOCKED');
});

test('unknown DOMException name → START_FAILED', () => {
    assert.equal(classifyStartError(ex('WeirdError', 'boom')).code, 'START_FAILED');
});

test('plain string → START_FAILED with coerced message', () => {
    const r = classifyStartError('kaboom');
    assert.equal(r.code, 'START_FAILED');
    assert.equal(r.message, 'kaboom');
});

test('null → START_FAILED, message coerced to "null"', () => {
    const r = classifyStartError(null);
    assert.equal(r.code, 'START_FAILED');
    assert.equal(r.message, 'null');
});
