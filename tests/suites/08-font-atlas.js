/* The glyph atlas replaced a per-pixel fillRect renderer. These tests prove the
   replacement paints exactly the same pixels, then guard the win.          */
'use strict';

/* Reference implementation: the ORIGINAL txt(), reduced to the set of lit
   device pixels it would fill for a given string. */
function expectedPixels(FONT, t, x, y, size, align) {
  t = String(t).toUpperCase().replace(/Ü/g, 'U');
  const sz = size || 8;
  const sc = sz <= 8 ? 1 : (sz <= 14 ? 2 : (sz <= 22 ? 3 : 4));
  const cw = 4 * sc, w = t.length * cw - sc;
  x = Math.round(x); y = Math.round(y) - 5 * sc;
  if (align === 'center') x -= Math.round(w / 2);
  if (align === 'right') x -= w;
  const px = new Set();
  for (let i = 0; i < t.length; i++) {
    const g = FONT[t[i]];
    if (!g) continue;
    for (let r = 0; r < 5; r++) for (let col = 0; col < 3; col++)
      if (g[r * 3 + col] === '1')
        for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++)
          px.add((x + i * cw + col * sc + dx) + ',' + (y + r * sc + dy));
  }
  return px;
}

/* What the atlas path actually paints: decode each drawImage back through the
   sheet's glyph layout into device pixels. */
function actualPixels(game, HOST, t, x, y, size, align) {
  const rec = [];
  HOST.ctxStats.record = rec;
  game.txt(t, x, y, '#f8f8f8', size, align);
  HOST.ctxStats.record = null;

  const FONT = game.FONT, KEYS = game.FONTKEYS;
  const sz = size || 8;
  const sc = sz <= 8 ? 1 : (sz <= 14 ? 2 : (sz <= 22 ? 3 : 4));
  const gw = 3 * sc, gh = 5 * sc;
  const px = new Set();
  for (const call of rec) {
    const [method, , sheet, sx, sy, sw, sh, dx, dy, dw, dh] = call;
    if (method !== 'drawImage') continue;
    if (sw !== gw || sh !== gh || dw !== gw || dh !== gh)
      throw new Error(`glyph blit is not 1:1 (src ${sw}x${sh} -> dst ${dw}x${dh})`);
    if (sy !== 0) throw new Error('sheet is a single row; sy should be 0, got ' + sy);
    const ix = sx / gw;
    if (!Number.isInteger(ix)) throw new Error('sx ' + sx + ' is not on a glyph boundary');
    const bits = FONT[KEYS[ix]];
    if (!bits) throw new Error('glyph index ' + ix + ' is out of range');
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++)
      if (bits[r * 3 + c] === '1')
        for (let yy = 0; yy < sc; yy++) for (let xx = 0; xx < sc; xx++)
          px.add((dx + c * sc + xx) + ',' + (dy + r * sc + yy));
  }
  return px;
}

const SAMPLES = [
  ['MECHA HITLER MUST DIE!', 40, 100, 8, undefined],
  ['SCORE: 1234567890', 128, 60, 8, 'center'],
  ['WAVE 15/15', 200, 10, 13, 'right'],
  ["THAT WAS LARRY'S COUSIN!", 8, 200, 7, undefined],
  ['SECTOR 9 CLEARED', 128, 88, 24, 'center'],
  ['A.B,C:D!E?F-G+H(I)', 4, 50, 6, undefined],
  ['↑↓←→ █░ · ►', 20, 30, 16, undefined],
  ['', 10, 10, 8, undefined],
  ['   ', 10, 10, 8, undefined],
];

module.exports = {
  name: 'glyph atlas',
  tests: {
    'paints exactly the pixels the per-pixel renderer did': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      const bad = [];
      for (const [t, x, y, size, align] of SAMPLES) {
        const want = expectedPixels(game.FONT, t, x, y, size, align);
        const got = actualPixels(game, HOST, t, x, y, size, align);
        const missing = [...want].filter((p) => !got.has(p));
        const extra = [...got].filter((p) => !want.has(p));
        if (missing.length || extra.length)
          bad.push(`"${t}" size=${size} align=${align}: ${missing.length} missing, ${extra.length} extra` +
            (missing.length ? ' e.g. missing ' + missing[0] : '') +
            (extra.length ? ' e.g. extra ' + extra[0] : ''));
      }
      ok(bad.length === 0, bad.join('\n        '));
    },

    'every glyph in the font round-trips through the sheet': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      const bad = [];
      for (const ch of game.FONTKEYS) {
        for (const size of [8, 13, 20, 24]) {
          const want = expectedPixels(game.FONT, ch, 30, 30, size, undefined);
          const got = actualPixels(game, HOST, ch, 30, 30, size, undefined);
          if (want.size !== got.size || [...want].some((p) => !got.has(p)))
            bad.push(JSON.stringify(ch) + ' @ ' + size);
        }
      }
      ok(bad.length === 0, 'glyphs that do not match: ' + bad.join(', '));
    },

    'one draw call per visible character, not one per lit pixel': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      const s = 'MECHA HITLER MUST DIE';
      HOST.ctxStats.calls = 0;
      HOST.ctxStats.byMethod = {};
      game.txt(s, 10, 10, '#f8f8f8', 8);
      const visible = s.replace(/ /g, '').length;
      const blits = HOST.ctxStats.byMethod.drawImage || 0;
      const rects = HOST.ctxStats.byMethod.fillRect || 0;
      ok(blits === visible, `expected ${visible} blits, got ${blits}`);
      ok(rects === 0, `expected no per-pixel fillRects, got ${rects}`);
    },

    'the sheet cache is reused across calls and stays bounded': ({ fresh, ok }) => {
      const { game } = fresh();
      const before = game.fontAtlas.size;
      for (let i = 0; i < 50; i++) game.txt('SAME COLOUR', 10, 10, '#ffe848', 8);
      ok(game.fontAtlas.size === before + 1,
        'repeat calls should build one sheet, size went ' + before + ' -> ' + game.fontAtlas.size);
      for (let i = 0; i < 400; i++) game.txt('X', 0, 0, '#' + (0x100000 + i).toString(16), 8);
      ok(game.fontAtlas.size <= 129, 'cache grew unbounded: ' + game.fontAtlas.size);
    },

    'text rendering cost dropped sharply in the worst-case scene':
      ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        game.setState('menu');
        for (let i = 0; i < 30; i++) { game.update(); game.render(); }   // warm the cache
        HOST.ctxStats.calls = 0;
        const FR = 200;
        for (let i = 0; i < FR; i++) { game.update(); game.render(); }
        const perFrame = HOST.ctxStats.calls / FR;
        // baseline before the atlas + sky bake: ~3,232 canvas calls/frame.
        // Now ~585. The bound is deliberately loose so ordinary art tweaks do
        // not trip it — it exists to catch a regression back to per-pixel text.
        ok(perFrame < 900,
          `main menu costs ${Math.round(perFrame)} canvas calls/frame (was ~3232, now ~585)`);
      },
  },
};
