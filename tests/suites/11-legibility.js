/* Signs and cheat codes were the two places the 3x5 face gave out. These pin
   the geometry: boards that fit their text and sit clear of the level, and end
   screens whose now-taller code rows still land inside the 256x224 frame. */
'use strict';

const ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* every glyph blit made by a draw, as device-space boxes */
function textBoxes(HOST, fn) {
  const rec = [];
  HOST.ctxStats.record = rec;
  fn();
  HOST.ctxStats.record = null;
  return rec.filter(([m]) => m === 'drawImage')
    .map(([, , , , , , , dx, dy, dw, dh]) => ({ x: dx, y: dy, w: dw, h: dh }));
}

module.exports = {
  name: 'sign & code legibility',
  tests: {
    'every sign board fits its own text': ({ fresh, ok }) => {
      const { game } = fresh();
      const bad = [];
      game.LEVELS.forEach((L, i) => {
        game.startLevel(i);
        for (const s of L.signs || []) {
          const b = game.signBox(s);
          const lines = Array.isArray(s.t) ? s.t : [s.t];
          for (const l of lines) {
            const w = game.txtLW(l, 1);
            if (w > b.bw - 6)
              bad.push(`S${i + 1} ${JSON.stringify(l)}: text ${w}px in a ${b.bw}px board`);
          }
        }
      });
      ok(bad.length === 0, bad.join('\n        '));
    },

    'no sign is hidden behind a platform': ({ fresh, ok }) => {
      const { game } = fresh();
      const bad = [];
      game.LEVELS.forEach((L, i) => {
        game.startLevel(i);
        for (const s of L.signs || []) {
          const b = game.signBox(s);
          const board = { x: b.bx, y: b.by, w: b.bw, h: b.bh };
          const post = { x: b.px - 2, y: game.GY - 24, w: 4, h: 24 };
          for (const p of L.plats || []) {
            const pr = { x: p.x, y: p.y, w: p.w, h: 6 };
            // platforms are drawn after the signs, so any overlap hides the sign
            if (ov(pr, board)) bad.push(`S${i + 1} sign@${s.x} board behind plat@${p.x},${p.y}`);
            if (ov(pr, post)) bad.push(`S${i + 1} sign@${s.x} post behind plat@${p.x},${p.y}`);
          }
        }
      });
      ok(bad.length === 0, bad.join('\n        '));
    },

    'no sign stands over a gap or overlaps another sign': ({ fresh, ok }) => {
      const { game } = fresh();
      const bad = [];
      game.LEVELS.forEach((L, i) => {
        game.startLevel(i);
        const seen = [];
        for (const s of L.signs || []) {
          const b = game.signBox(s);
          for (const g of L.gaps || []) {
            if (!g.w) continue;
            if (b.px > g.x && b.px < g.x + g.w)
              bad.push(`S${i + 1} sign@${s.x} post floats over the gap at ${g.x}`);
          }
          const board = { x: b.bx, y: b.by, w: b.bw, h: b.bh };
          for (const o of seen) if (ov(board, o)) bad.push(`S${i + 1} sign@${s.x} overlaps another sign`);
          seen.push(board);
        }
      });
      ok(bad.length === 0, bad.join('\n        '));
    },

    'signs render in the legible face, not the HUD face': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.startLevel(0); game.state = 'play'; game.cam = 60;
      const boxes = textBoxes(HOST, () => game.drawSigns());
      ok(boxes.length > 0, 'no sign text drawn at all');
      const heights = [...new Set(boxes.map((b) => b.h))];
      ok(heights.every((h) => h === game.FACE_L.h),
        `sign glyphs are ${heights.join(',')}px tall, expected ${game.FACE_L.h} (the legible face)`);
    },

    'multi-line signs stack their lines without overlapping': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.startLevel(0); game.state = 'play';
      const multi = game.LEVELS[0].signs.find((s) => Array.isArray(s.t));
      ok(multi, 'stage one should have a stacked sign after the rework');
      const b = game.signBox(multi);
      game.cam = b.bx - 40;
      const boxes = textBoxes(HOST, () => game.drawSigns());
      const rows = [...new Set(boxes.map((g) => g.y))].sort((a, z) => a - z);
      ok(rows.length >= 2, 'expected at least two text rows on the stacked sign');
      for (let i = 1; i < rows.length; i++)
        ok(rows[i] - rows[i - 1] >= game.FACE_L.h, `sign lines only ${rows[i] - rows[i - 1]}px apart`);
      // and every glyph must land inside the plank
      const board = { x: b.bx - game.cam, y: b.by, w: b.bw, h: b.bh };
      for (const g of boxes)
        ok(g.x >= board.x && g.x + g.w <= board.x + board.w &&
           g.y >= board.y && g.y + g.h <= board.y + board.h,
        `glyph at ${g.x},${g.y} spills outside the plank`);
    },

    'cheat codes use the legible face with double-size arrows': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      const c = game.CHEATS[0];
      const boxes = textBoxes(HOST, () => game.drawCodeRow(c, 100));
      ok(boxes.length > 0, 'nothing drawn');
      const hs = [...new Set(boxes.map((b) => b.h))].sort((a, z) => a - z);
      ok(hs.includes(game.FACE_L.h), 'label should be the legible face at scale 1');
      ok(hs.includes(game.FACE_L.h * 2), 'arrows should be drawn at double scale');
      // all glyphs sit on one baseline
      const bottoms = [...new Set(boxes.map((b) => b.y + b.h))];
      ok(bottoms.length === 1, 'label and arrows should share a baseline, got ' + bottoms.join(','));
    },

    /* Vertical only: the news ticker is a marquee that deliberately scrolls in
       from beyond the right edge, so horizontal overflow is by design. Vertical
       is what the taller code rows put at risk. */
    'no end-of-level text runs off the top or bottom of the frame':
      ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        const bad = [];
        const check = (label, boxes) => {
          for (const g of boxes)
            if (g.y < 0 || g.y + g.h > game.H)
              bad.push(`${label}: glyph at y=${g.y} (${g.h} tall) outside 0..${game.H}`);
        };
        for (let L = 0; L < game.LEVELS.length; L++) {
          game.startLevel(L);
          game.state = 'lvlwin'; game.winT = 120; game.score = 123456; game.runGold = 42;
          check(`sector ${L + 1} lvlwin`, textBoxes(HOST, () => game.render()));
        }
        game.startLevel(game.LEVELS.length - 1);
        game.state = 'win'; game.winT = 120; game.score = 999999;
        check('win screen', textBoxes(HOST, () => game.render()));
        ok(bad.length === 0, [...new Set(bad)].slice(0, 6).join('\n        '));
      },

    /* The arrows are now 14px tall instead of 5. This checks that growing them
       did not push them into a neighbouring line of the end-of-level panel.
       The panel is translucent and the frozen level renders through it, so the
       camera is parked past the last sign first — a sign showing through the
       overlay is the design, not a collision. */
    'the enlarged code arrows collide with nothing else on the panel':
      ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        const bad = [];
        const big = game.FACE_L.h * 2;
        for (let L = 0; L < game.LEVELS.length; L++) {
          if (!game.codesFor(L).length) continue;
          for (const st of ['lvlwin', 'win']) {
            if (st === 'win' && L !== game.LEVELS.length - 1) continue;
            game.startLevel(L);
            game.state = st; game.winT = 120; game.score = 4242;
            const signs = game.LEVELS[L].signs || [];
            game.cam = signs.length ? Math.max(...signs.map((s) => s.x)) + 400 : 1200;
            const boxes = textBoxes(HOST, () => game.render());
            const arrows = boxes.filter((b) => b.h === big);
            const others = boxes.filter((b) => b.h !== big);
            if (!arrows.length) { bad.push(`sector ${L + 1} ${st}: no double-size arrows drawn`); continue; }
            for (const a of arrows) for (const o of others)
              if (ov(a, o))
                bad.push(`sector ${L + 1} ${st}: arrow at ${a.x},${a.y} overlaps text at ${o.x},${o.y}`);
          }
        }
        ok(bad.length === 0, [...new Set(bad)].slice(0, 6).join('\n        '));
      },
  },
};
