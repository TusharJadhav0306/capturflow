// Unit tests for environment detection + MIME selection.
// Stubs browser globals (navigator/window/MediaRecorder) and exercises the
// built ESM bundle, so it runs in plain Node with no browser.
//
//   npm test        (builds first via pretest, then runs this)
//
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../dist/index.esm.js';

/** Install fake browser globals for one detect() call. */
function setEnv({ ua, platform = '', uaPlatform = '', docPip = false, getDisplayMedia = true, mimes = [] }) {
    const nav = {
        userAgent: ua,
        platform,
        userAgentData: uaPlatform ? { platform: uaPlatform } : undefined,
        mediaDevices: getDisplayMedia ? { getDisplayMedia() {}, getUserMedia() {} } : {},
    };
    define('navigator', nav);
    define('window', docPip ? { documentPictureInPicture: {}, outerHeight: 900, innerHeight: 780 } : { outerHeight: 900, innerHeight: 780 });
    define('MediaRecorder', { isTypeSupported: (t) => mimes.includes(t) });
}
function define(name, value) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
function clearEnv() {
    define('navigator', undefined);
    define('window', undefined);
    define('MediaRecorder', undefined);
}

const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const MP4  = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'];

const UA = {
    chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    edgeWin:   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Edg/124.0',
    firefoxWin:'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    firefoxMac:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
    safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    safariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
};

test('Chrome on Windows → chrome/windows, document-pip, webm, capture supported', () => {
    setEnv({ ua: UA.chromeWin, platform: 'Win32', docPip: true, mimes: [...WEBM, ...MP4] });
    const e = detect();
    assert.equal(e.browser, 'chrome');
    assert.equal(e.os, 'windows');
    assert.equal(e.recommendedPipStrategy, 'document-pip');
    assert.ok(e.mimeType.startsWith('video/webm'), `expected webm, got ${e.mimeType}`);
    assert.equal(e.screenCaptureSupported, true);
    assert.equal(e.isMobile, false);
});

test('Edge on Windows → edge, document-pip', () => {
    setEnv({ ua: UA.edgeWin, platform: 'Win32', docPip: true, mimes: [...WEBM, ...MP4] });
    const e = detect();
    assert.equal(e.browser, 'edge');
    assert.equal(e.recommendedPipStrategy, 'document-pip');
});

test('Firefox on Windows → floating (no Document PiP)', () => {
    setEnv({ ua: UA.firefoxWin, platform: 'Win32', docPip: false, mimes: WEBM });
    const e = detect();
    assert.equal(e.browser, 'firefox');
    assert.equal(e.os, 'windows');
    assert.equal(e.recommendedPipStrategy, 'floating');
    assert.ok(e.mimeType.startsWith('video/webm'));
});

test('Firefox on macOS → popup (activation workaround)', () => {
    setEnv({ ua: UA.firefoxMac, platform: 'MacIntel', docPip: false, mimes: WEBM });
    const e = detect();
    assert.equal(e.browser, 'firefox');
    assert.equal(e.os, 'mac');
    assert.equal(e.recommendedPipStrategy, 'popup');
});

test('Safari on macOS → safari/mac, FLOATING (popup steals focus → breaks getDisplayMedia), MP4', () => {
    setEnv({ ua: UA.safariMac, platform: 'MacIntel', docPip: false, mimes: MP4 });
    const e = detect();
    assert.equal(e.browser, 'safari');
    assert.equal(e.os, 'mac');
    // NOT 'popup': opening a window before getDisplayMedia loses the user gesture on WebKit.
    assert.equal(e.recommendedPipStrategy, 'floating');
    assert.ok(e.mimeType.startsWith('video/mp4'), `expected mp4, got ${e.mimeType}`);
});

test('auto MIME prefers webm even when mp4 is also supported (Chrome duration bug guard)', () => {
    setEnv({ ua: UA.chromeWin, platform: 'Win32', docPip: true, mimes: [...MP4, ...WEBM] });
    const e = detect();
    assert.ok(e.mimeType.startsWith('video/webm'),
        `auto must prefer webm so fix-webm-duration applies, got ${e.mimeType}`);
});

test('Chrome on Android → mobile, screen capture NOT supported', () => {
    setEnv({ ua: UA.chromeAndroid, platform: '', docPip: false, getDisplayMedia: true, mimes: WEBM });
    const e = detect();
    assert.equal(e.os, 'android');
    assert.equal(e.isMobile, true);
    assert.equal(e.screenCaptureSupported, false, 'mobile has no usable getDisplayMedia');
});

test('Safari on iOS → ios, mobile, screen capture NOT supported', () => {
    setEnv({ ua: UA.safariIOS, platform: 'iPhone', docPip: false, getDisplayMedia: false, mimes: MP4 });
    const e = detect();
    assert.equal(e.os, 'ios');
    assert.equal(e.isMobile, true);
    assert.equal(e.screenCaptureSupported, false);
});

test('Mac detected from userAgentData when navigator.platform is empty', () => {
    setEnv({ ua: UA.firefoxMac, platform: '', uaPlatform: 'macOS', docPip: false, mimes: WEBM });
    const e = detect();
    assert.equal(e.os, 'mac');
    assert.equal(e.recommendedPipStrategy, 'popup');
});

test('SSR / no navigator → safe unknown env, no throw', () => {
    clearEnv();
    const e = detect();
    assert.equal(e.browser, 'unknown');
    assert.equal(e.screenCaptureSupported, false);
    assert.equal(e.recommendedPipStrategy, 'floating');
});
