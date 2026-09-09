/* Both faces blit from a baked atlas rather than painting per pixel. These
   tests prove what lands on screen is exactly the glyph art in the source —
   for the 3x5 face against the original per-pixel renderer it replaced, and
   for the 5x7 face against the picture rows it is authored as.            */
'use strict';

/* the ORIGINAL 3x5 txt(), reduced to the set of lit device pixels */
function expectedSmall(FONT, t, x, y, size, align) {
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

/* decode the blits a face actually made back into device pixels */
function actual(game, HOST, face, draw, sc) {
  const rec = [];
  HOST.ctxStats.record = rec;
  draw();
  HOST.ctxStats.record = null;
  const gw = face.w * sc, gh = face.h * sc;
  const px = new Set();
  for (const call of rec) {
    const [method, , , sx, sy, sw, sh, dx, dy, dw, dh] = call;
    if (method !== 'drawImage') continue;
    if (sw !== gw || sh !== gh || dw !== gw || dh !== gh)
      throw new Error(`glyph blit is not 1:1 (src ${sw}x${sh} -> dst ${dw}x${dh})`);
    if (sy !== 0) throw new Error('sheet is one row; sy should be 0, got ' + sy);
    const ix = sx / gw;
    if (!Number.isInteger(ix)) throw new Error('sx ' + sx + ' is off a glyph boundary');
    const bits = face.glyphs[face.keys[ix]];
    if (!bits) throw new Error('glyph index ' + ix + ' out of range');
    for (let r = 0; r < face.h; r++) for (let c = 0; c < face.w; c++)
      if (bits[r * face.w + c] === '1')
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
    '3x5: paints exactly the pixels the per-pixel renderer did': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      const bad = [];
      for (const [t, x, y, size, align] of SAMPLES) {
        const sc = (size || 8) <= 8 ? 1 : ((size || 8) <= 14 ? 2 : ((size || 8) <= 22 ? 3 : 4));
        const want = expectedSmall(game.FONT, t, x, y, size, align);
        const got = actual(game, HOST, game.FACE_S,
          () => game.txt(t, x, y, '#f8f8f8', size, align), sc);
        const missing = [...want].filter((p) => !got.has(p));
        const extra = [...got].filter((p) => !want.has(p));
        if (missing.length || extra.length)
          bad.push(`"${t}" size=${size}: ${missing.length} missing, ${extra.length} extra`);
      }
      ok(bad.length === 0, bad.join('\n        '));
    },

    'both faces round-trip every glyph at every scale': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      const bad = [];
      for (const [label, face, drawFn] of [
        ['3x5', game.FACE_S, (ch, sc) => game.txt(ch, 30, 30, '#f8f8f8', sc === 1 ? 8 : (sc === 2 ? 13 : 20))],
        ['5x7', game.FACE_L, (ch, sc) => game.txtL(ch, 30, 30, '#f8f8f8', sc)],
      ]) {
        for (const ch of face.keys) {
          for (const sc of [1, 2, 3]) {
            const got = actual(game, HOST, face, () => drawFn(ch, sc), sc);
            const bits = face.glyphs[ch];
            const lit = (bits.match(/1/g) || []).length;
            if (got.size !== lit * sc * sc)
              bad.push(`${label} ${JSON.stringify(ch)} @${sc}: ${got.size} px, expected ${lit * sc * sc}`);
          }
        }
      }
      ok(bad.length === 0, bad.slice(0, 6).join('\n        '));
    },

    '5x7 glyphs match the picture rows they are authored as': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      const bad = [];
      for (const ch of Object.keys(game.FONT_L_ART)) {
        const art = game.FONT_L_ART[ch];
        const want = new Set();
        art.forEach((row, r) => {
          if (row.length !== 5) bad.push(`${JSON.stringify(ch)} row ${r} is ${row.length} wide, not 5`);
          [...row].forEach((c, i) => { if (c === '#') want.add((30 + i) + ',' + (30 - 7 + r)); });
        });
        if (art.length !== 7) { bad.push(`${JSON.stringify(ch)} is ${art.length} rows, not 7`); continue; }
        const got = actual(game, HOST, game.FACE_L, () => game.txtL(ch, 30, 30, '#f8f8f8', 1), 1);
        const missing = [...want].filter((p) => !got.has(p));
        const extra = [...got].filter((p) => !want.has(p));
        if (missing.length || extra.length)
          bad.push(`${JSON.stringify(ch)}: ${missing.length} missing, ${extra.length} extra`);
      }
      ok(bad.length === 0, bad.slice(0, 6).join('\n        '));
    },

    'the two faces cover exactly the same characters': ({ fresh, ok }) => {
      const { game } = fresh();
      const s = new Set(game.FACE_S.keys), l = new Set(game.FACE_L.keys);
      const onlyS = [...s].filter((k) => !l.has(k));
      const onlyL = [...l].filter((k) => !s.has(k));
      ok(onlyS.length === 0, 'only in the 3x5 face: ' + JSON.stringify(onlyS));
      ok(onlyL.length === 0, 'only in the 5x7 face: ' + JSON.stringify(onlyL));
    },

    'the arrows are unmistakable in the legible face': ({ fresh, ok }) => {
      const { game } = fresh();
      // the whole point of the big face: up must not read as down at a glance
      const g = game.FONT_L;
      const pairs = [['↑', '↓'], ['←', '→']];
      for (const [a, b] of pairs) {
        let diff = 0;
        for (let i = 0; i < 35; i++) if (g[a][i] !== g[b][i]) diff++;
        ok(diff >= 10, `${a} and ${b} differ in only ${diff} of 35 pixels`);
      }
      // and each arrow must have a solid head: some row fully lit
      for (const a of ['↑', '↓', '←', '→']) {
        const rows = game.FONT_L_ART[a];
        ok(rows.some((r) => r === '#####'), `${a} has no solid head row`);
      }
    },

    'one draw call per visible character, not one per lit pixel': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      const s = 'MECHA HITLER MUST DIE';
      const visible = s.replace(/ /g, '').length;
      for (const [label, draw] of [
        ['3x5', () => game.txt(s, 10, 10, '#f8f8f8', 8)],
        ['5x7', () => game.txtL(s, 10, 10, '#f8f8f8', 1)],
      ]) {
        draw();                                   // warm the sheet: baking it
        HOST.ctxStats.calls = 0;                  // is itself a burst of fillRects
        HOST.ctxStats.byMethod = {};
        draw();
        ok((HOST.ctxStats.byMethod.drawImage || 0) === visible,
          `${label}: expected ${visible} blits, got ${HOST.ctxStats.byMethod.drawImage || 0}`);
        ok((HOST.ctxStats.byMethod.fillRect || 0) === 0,
          `${label}: expected no per-pixel fillRects`);
      }
    },

    'each face caches its sheets and stays bounded': ({ fresh, ok }) => {
      const { game } = fresh();
      for (const [label, face, draw] of [
        ['3x5', game.FACE_S, (col) => game.txt('SAME', 10, 10, col, 8)],
        ['5x7', game.FACE_L, (col) => game.txtL('SAME', 10, 10, col, 1)],
      ]) {
        const before = face.atlas.size;
        for (let i = 0; i < 50; i++) draw('#ffe848');
        ok(face.atlas.size === before + 1,
          `${label}: repeat calls should build one sheet, ${before} -> ${face.atlas.size}`);
        for (let i = 0; i < 400; i++) draw('#' + (0x100000 + i).toString(16));
        ok(face.atlas.size <= 129, `${label}: cache grew unbounded (${face.atlas.size})`);
      }
    },

    'text rendering cost stays far below the pre-atlas baseline': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.setState('menu');
      for (let i = 0; i < 30; i++) { game.update(); game.render(); }
      HOST.ctxStats.calls = 0;
      const FR = 200;
      for (let i = 0; i < FR; i++) { game.update(); game.render(); }
      const perFrame = HOST.ctxStats.calls / FR;
      ok(perFrame < 900,
        `main menu costs ${Math.round(perFrame)} canvas calls/frame (was ~3232 pre-atlas)`);
    },
  },
};
