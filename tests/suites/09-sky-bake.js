/* drawSky's dithered banding was 1,280 single-pixel fillRects per frame and is
   entirely static. It is now baked once into an offscreen canvas. These tests
   prove the baked image is the same picture, and that the layering the scene
   depends on (bands -> stars -> moon) is preserved.                        */
'use strict';

/* Minimal software raster: replay recorded fillRect calls into a pixel map.
   Enough for drawSky's banding, which is pure fillRect. */
function rasterise(calls) {
  const px = new Map();
  let style = '#000000';
  for (const [method, , ...a] of calls) {
    if (method === 'fillRect') {
      const [x, y, w, h] = a;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px.set(xx + ',' + yy, style);
    }
  }
  return px;
}
/* a recording 2D context that also tracks fillStyle */
function recorder(sink) {
  const ctx = {
    _style: '#000000',
    get fillStyle() { return this._style; },
    set fillStyle(v) { this._style = v; },
    fillRect(x, y, w, h) { sink.push(['fillRect', null, x, y, w, h, this._style]); },
    imageSmoothingEnabled: false,
  };
  return ctx;
}
function rasteriseStyled(calls) {
  const px = new Map();
  for (const [, , x, y, w, h, style] of calls)
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px.set(xx + ',' + yy, style);
  return px;
}

/* The ORIGINAL inline banding loop, verbatim from before the bake. */
function originalBands(W) {
  const bands = ['#0c0618', '#150a26', '#1e0e34', '#2a1240', '#331641', '#3a1838'];
  const bh = [26, 26, 26, 30, 40, 44];
  const calls = [];
  let by = 0, style = '#000';
  const fill = (x, y, w, h) => calls.push(['fillRect', null, x, y, w, h, style]);
  for (let i = 0; i < bands.length; i++) {
    style = bands[i]; fill(0, by, W, bh[i]);
    if (i < bands.length - 1) {
      style = bands[i + 1];
      for (let x = (by % 2); x < W; x += 2) fill(x, by + bh[i] - 1, 1, 1);
      style = bands[i];
      for (let x = ((by + 1) % 2); x < W; x += 2) fill(x, by + bh[i], 1, 1);
    }
    by += bh[i];
  }
  return calls;
}

module.exports = {
  name: 'sky bake',
  tests: {
    'the baked sky is pixel-identical to the old per-pixel banding':
      ({ fresh, ok }) => {
        const { game } = fresh();
        const sink = [];
        game.paintSkyBands(recorder(sink));
        const got = rasteriseStyled(sink);
        const want = rasteriseStyled(originalBands(game.W));

        const diffs = [];
        for (const [k, v] of want) if (got.get(k) !== v) diffs.push(`${k}: want ${v}, got ${got.get(k)}`);
        for (const k of got.keys()) if (!want.has(k)) diffs.push(`${k}: painted but should not be`);
        ok(diffs.length === 0,
          `${diffs.length} pixels differ, e.g.\n        ` + diffs.slice(0, 4).join('\n        '));
      },

    'the bake covers the sky region and nothing below the ground line':
      ({ fresh, ok, eq }) => {
        const { game } = fresh();
        const sink = [];
        const painted = game.paintSkyBands(recorder(sink));
        eq(painted, game.GY, 'bands should total exactly GY');
        const sheet = game.skySheet();
        eq(sheet.width, game.W, 'sheet width');
        eq(sheet.height, game.GY, 'sheet height');
        const maxY = Math.max(...sink.map(([, , , y, , h]) => y + h));
        ok(maxY <= game.GY, 'banding painted below GY: ' + maxY);
      },

    'the sheet is built once and reused': ({ fresh, ok }) => {
      const { game } = fresh();
      const a = game.skySheet();
      const b = game.skySheet();
      ok(a === b, 'skySheet() rebuilt the canvas instead of caching it');
    },

    'layering survives: sky blit, then stars, then the moon': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.startLevel(0);
      game.skySheet();                       // build before recording
      const rec = [];
      HOST.ctxStats.record = rec;
      game.drawSky();
      HOST.ctxStats.record = null;

      const seq = rec.map(([m]) => m);
      const blit = seq.indexOf('drawImage');
      const firstStar = seq.indexOf('fillRect');
      const firstArc = seq.indexOf('arc');
      ok(blit === 0, 'sky blit should be the first thing drawn, was at ' + blit);
      ok(firstStar > blit, 'stars must be drawn over the sky');
      ok(firstArc > firstStar, 'the moon must be drawn over the stars, as it was before');
    },

    'drawSky costs an order of magnitude less than it used to': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.startLevel(0);
      game.skySheet();
      HOST.ctxStats.calls = 0;
      for (let i = 0; i < 50; i++) game.drawSky();
      const per = HOST.ctxStats.calls / 50;
      ok(per < 100, `drawSky is ${Math.round(per)} calls/frame (was ~1335)`);
    },
  },
};
