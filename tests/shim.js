/* MHMD headless harness — fake DOM / Canvas2D / WebAudio / localStorage.
   Design rules (from the handoff's "harness lessons"):
     - unknown getElementById MUST return null (fabricating elements masked bug #2)
     - addEventListener is a REAL registry; tests drive the game through dispatch()
     - rAF/setInterval are manual pumps so frames and music steps are deterministic
*/
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(process.env.MHMD_HTML || 'index.html', 'utf8');

// ---- element registry built from the REAL html, so wrong-ID lookups return null
const IDS = new Set();
for (const m of HTML.matchAll(/\bid="([^"]+)"/g)) IDS.add(m[1]);

function mkListenerHost(label) {
  const L = Object.create(null);
  return {
    __label: label,
    __listeners: L,
    addEventListener(type, fn) { (L[type] || (L[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      if (!L[type]) return;
      const i = L[type].indexOf(fn);
      if (i >= 0) L[type].splice(i, 1);
    },
    dispatchEvent(ev) { return HOST.fire(this, ev.type, ev); },
  };
}

// ---- Canvas 2D: no-op draw surface that still records call counts
const ctxStats = { calls: 0, byMethod: Object.create(null) };
function makeCtx(canvas) {
  const real = {
    canvas,
    imageSmoothingEnabled: false,
    measureText: (s) => ({ width: String(s).length * 6 }),
    getImageData: (x, y, w, h) => ({
      width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
    }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
  };
  return new Proxy(real, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      return (...a) => {
        ctxStats.calls++;
        ctxStats.byMethod[k] = (ctxStats.byMethod[k] || 0) + 1;
        return undefined;
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeElement(id, tag) {
  const el = mkListenerHost('#' + (id || tag));
  el.id = id || '';
  el.tagName = (tag || 'div').toUpperCase();
  el.width = 0; el.height = 0;
  el.style = {};
  el.className = '';
  const cls = new Set();
  el.classList = {
    add: (c) => cls.add(c),
    remove: (c) => cls.delete(c),
    contains: (c) => cls.has(c),
    toggle: (c, f) => (f ? cls.add(c) : cls.delete(c)),
    __set: cls,
  };
  el.getBoundingClientRect = () => ({
    left: el.__rect ? el.__rect.left : 0,
    top: el.__rect ? el.__rect.top : 0,
    width: el.__rect ? el.__rect.width : (el.width || 256),
    height: el.__rect ? el.__rect.height : (el.height || 224),
  });
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  el.appendChild = () => {};
  el.removeChild = () => {};
  el.focus = () => {};
  el.getContext = () => (el.__ctx || (el.__ctx = makeCtx(el)));
  return el;
}

const elements = new Map();
for (const id of IDS) elements.set(id, makeElement(id));

// ---- document / window
const documentObj = mkListenerHost('document');
documentObj.hidden = false;
documentObj.getElementById = (id) => (elements.has(id) ? elements.get(id) : null);
documentObj.createElement = (tag) => makeElement('', tag);
documentObj.querySelector = () => null;
documentObj.body = makeElement('body', 'body');
documentObj.documentElement = makeElement('html', 'html');

const windowObj = mkListenerHost('window');

// ---- WebAudio
let audioTime = 0;
const audioLog = [];
function FakeParam(v) {
  return {
    value: v,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    setTargetAtTime() { return this; },
    cancelScheduledValues() { return this; },
  };
}
function FakeNode(kind) {
  const n = {
    kind,
    connect: (d) => d,
    disconnect() {},
    start() { audioLog.push(kind); },
    stop() {},
    gain: FakeParam(1),
    frequency: FakeParam(440),
    detune: FakeParam(0),
    Q: FakeParam(1),
    delayTime: FakeParam(0),
    type: 'sine',
    buffer: null,
    loop: false,
    playbackRate: FakeParam(1),
    onended: null,
  };
  return n;
}
class FakeAC {
  constructor() {
    this.sampleRate = 44100;
    this.destination = FakeNode('destination');
    this.state = 'running';
  }
  get currentTime() { return audioTime; }
  createGain() { return FakeNode('gain'); }
  createOscillator() { return FakeNode('osc'); }
  createBiquadFilter() { return FakeNode('filter'); }
  createDelay() { return FakeNode('delay'); }
  createWaveShaper() { return FakeNode('shaper'); }
  createDynamicsCompressor() { return FakeNode('comp'); }
  createStereoPanner() { return FakeNode('pan'); }
  createConvolver() { return FakeNode('conv'); }
  createBufferSource() { return FakeNode('bufsrc'); }
  createBuffer(ch, len) {
    const data = new Float32Array(len);
    return { numberOfChannels: ch, length: len, getChannelData: () => data };
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

// ---- timers: manual pumps
const rafQueue = [];
const intervals = [];
const timeouts = [];
let nowMs = 0;

// ---- the harness control surface
const HOST = {
  ids: IDS,
  elements,
  document: documentObj,
  window: windowObj,
  ctxStats,
  audioLog,
  errors: [],
  logs: [],
  clipboard: '',
  get audioTime() { return audioTime; },
  set audioTime(v) { audioTime = v; },

  /** fire a registered listener set; returns number of handlers run */
  fire(target, type, ev) {
    const hs = target.__listeners[type];
    if (!hs || !hs.length) return 0;
    for (const h of hs.slice()) h.call(target, ev);
    return hs.length;
  },

  /** dispatch to document + window + (optionally) a specific element */
  dispatch(type, ev = {}, target) {
    const e = Object.assign({
      type,
      preventDefault() {}, stopPropagation() {},
      clientX: 0, clientY: 0, pointerId: 1, button: 0, key: '', pointerType: 'touch',
    }, ev);
    let n = 0;
    if (target) n += HOST.fire(target, type, e);
    else {
      n += HOST.fire(documentObj, type, e);
      n += HOST.fire(windowObj, type, e);
    }
    return n;
  },

  /** tap canvas at native 256x224 coords */
  tapCanvas(x, y, extra = {}) {
    const cv = elements.get('cv');
    const ev = Object.assign({
      clientX: x, clientY: y, pointerId: 1,
      preventDefault() {}, stopPropagation() {}, type: 'pointerdown',
    }, extra);
    HOST.fire(documentObj, 'pointerdown', ev);
    HOST.fire(cv, 'pointerdown', ev);
    return ev;
  },
  releaseCanvas(x, y, extra = {}) {
    const ev = Object.assign({
      clientX: x, clientY: y, pointerId: 1,
      preventDefault() {}, stopPropagation() {}, type: 'pointerup',
    }, extra);
    HOST.fire(documentObj, 'pointerup', ev);
    return ev;
  },

  key(k, down = true) {
    HOST.dispatch(down ? 'keydown' : 'keyup', { key: k });
  },
  press(k) { HOST.key(k, true); },
  release(k) { HOST.key(k, false); },

  /** run N animation frames */
  frames(n = 1) {
    for (let i = 0; i < n; i++) {
      nowMs += 16.67;
      const q = rafQueue.splice(0, rafQueue.length);
      for (const fn of q) fn(nowMs);
    }
  },
  /** advance audio clock and pump the music scheduler intervals */
  music(seconds) {
    const stepMs = 25;
    const total = Math.round(seconds * 1000);
    for (let t = 0; t < total; t += stepMs) {
      audioTime += stepMs / 1000;
      for (const iv of intervals) if (iv.ms <= stepMs || t % iv.ms < stepMs) iv.fn();
    }
  },
  flushTimeouts(maxMs = 1e9) {
    const due = timeouts.splice(0, timeouts.length);
    for (const t of due) if (t.ms <= maxMs) t.fn();
  },
  intervals, timeouts, rafQueue,
};

// ---- globals installed on the sandbox
const G = {
  window: windowObj,
  document: documentObj,
  navigator: {
    maxTouchPoints: 0,
    getGamepads: () => [],
    userAgent: 'mhmd-harness',
    clipboard: {
      writeText: (s) => { HOST.clipboard = String(s); return Promise.resolve(); },
      readText: () => Promise.resolve(HOST.clipboard || ''),
    },
    // deliberately no requestMIDIAccess: exercises the graceful-degradation path
  },
  location: { href: 'file:///index.html', search: '', hash: '' },
  innerWidth: 1024,
  innerHeight: 768,
  devicePixelRatio: 1,
  matchMedia: (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: () => {},
  setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
  clearInterval: () => {},
  setTimeout: (fn, ms) => { timeouts.push({ fn, ms: ms || 0 }); return timeouts.length; },
  clearTimeout: () => {},
  performance: { now: () => nowMs },
  // the game logs debug reports and error traces; keep them out of the test
  // output unless asked, but always record them so suites can assert on them
  console: Object.assign(Object.create(console), {
    log: (...a) => { HOST.logs.push(a.join(' ')); if (process.env.MHMD_VERBOSE) console.log(...a); },
    warn: (...a) => { HOST.logs.push(a.join(' ')); if (process.env.MHMD_VERBOSE) console.warn(...a); },
    error: (...a) => { HOST.logs.push(a.join(' ')); if (process.env.MHMD_VERBOSE) console.error(...a); },
  }),
  AudioContext: FakeAC,
  webkitAudioContext: FakeAC,
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error, Map, Set, WeakSet, WeakMap,
  Promise, Symbol, RegExp, Float32Array, Uint8Array, Uint8ClampedArray, Int32Array, isNaN, isFinite,
  parseInt, parseFloat, encodeURIComponent, decodeURIComponent, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
};
G.globalThis = G;
G.self = G;
G.top = G;
// `window.X` must resolve to the same globals a browser would expose, while
// window's own listener registry stays intact.
const windowProxy = new Proxy(windowObj, {
  get(t, k) { return k in t ? t[k] : G[k]; },
  set(t, k, v) { if (k in t) { t[k] = v; } else { G[k] = v; } return true; },
  has(t, k) { return k in t || k in G; },
});
G.window = windowProxy;
HOST.window = windowProxy;
// window.addEventListener must be the same registry as bare addEventListener
G.addEventListener = (t, fn) => windowObj.addEventListener(t, fn);
G.removeEventListener = (t, fn) => windowObj.removeEventListener(t, fn);
G.dispatchEvent = (ev) => HOST.dispatch(ev.type, ev);

// ---- localStorage
const store = new Map();
G.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
HOST.store = store;

module.exports = { HOST, G, FakeAC, makeElement, HTML };
