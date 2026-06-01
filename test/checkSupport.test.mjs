// Unit tests for CapturFlow.checkSupport() — stubs browser globals, runs in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSupport } from '../dist/index.esm.js';

function define(name, value) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
function setEnv({ ua, platform = '', secure = true, recorder = true, getUserMedia = true, getDisplayMedia = true }) {
    const md = {};
    if (getUserMedia)    md.getUserMedia = () => {};
    if (getDisplayMedia) md.getDisplayMedia = () => {};
    define('navigator', { userAgent: ua, platform, mediaDevices: md });
    define('window', { isSecureContext: secure });
    define('MediaRecorder', recorder ? { isTypeSupported: () => true } : undefined);
}
function clearEnv() {
    define('navigator', undefined);
    define('window', undefined);
    define('MediaRecorder', undefined);
}

const CHROME_WIN     = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

test('desktop Chrome, secure → supported, no reasons', () => {
    setEnv({ ua: CHROME_WIN, platform: 'Win32' });
    const r = checkSupport();
    assert.equal(r.supported, true);
    assert.deepEqual(r.reasons, []);
    assert.equal(r.screen, true);
    assert.equal(r.secureContext, true);
});

test('insecure context → not supported, secure-context reason', () => {
    setEnv({ ua: CHROME_WIN, platform: 'Win32', secure: false });
    const r = checkSupport();
    assert.equal(r.supported, false);
    assert.ok(r.reasons.some((x) => /secure/i.test(x)));
});

test('no MediaRecorder → not supported, MediaRecorder reason', () => {
    setEnv({ ua: CHROME_WIN, platform: 'Win32', recorder: false });
    const r = checkSupport();
    assert.equal(r.supported, false);
    assert.ok(r.reasons.some((x) => /MediaRecorder/i.test(x)));
});

test('mobile → screen unsupported; not supported by default but OK when screen not required', () => {
    setEnv({ ua: CHROME_ANDROID, platform: '' });
    const r = checkSupport();
    assert.equal(r.screen, false);
    assert.equal(r.supported, false);
    assert.ok(r.reasons.some((x) => /mobile/i.test(x)));

    const r2 = checkSupport({ screen: false });
    assert.equal(r2.supported, true, 'webcam+audio+secure+recorder present, screen not required');
});

test('SSR / no globals → all false, no throw', () => {
    clearEnv();
    const r = checkSupport();
    assert.equal(r.supported, false);
    assert.equal(r.screen, false);
    assert.equal(r.secureContext, false);
});
