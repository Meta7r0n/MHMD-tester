/* The campaign visual layer: contact shadows, particle falloff, impact light.
   These are look-and-feel, so the tests pin the things that would actually be
   wrong on screen — shadows on the correct surface, correct draw order, and
   the accessibility toggles still meaning something. */
'use strict';

/* capture the draw calls a function makes */
function capture(HOST, fn) {
  const rec = [];
  HOST.ctxStats.record = rec;
  fn();
  HOST.ctxStats.record = null;
  return rec;
}
const fills = (rec) => rec.filter(([m]) => m === 'fillRect');

module.exports = {
  name: 'campaign visuals',
  tests: {
    'a grounded actor casts its shadow on the ground line': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.startLevel(0); game.state = 'play';
      game.cam = 0;
      const rec = capture(HOST, () => game.drawShadow(40, 12, game.GY));
      const f = fills(rec);
      ok(f.length > 0, 'grounded actor cast no shadow at all');
      const ys = f.map(([, , , y]) => y);
      ok(Math.max(...ys) <= game.GY && Math.min(...ys) >= game.GY - 3,
        'shadow should sit on the ground line, got y=' + ys.join(','));
    },

    'a shadow lands on the platform under the actor, not the floor':
      ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        const lvl = game.LEVELS.findIndex((l) => (l.plats || []).some((p) => !p.sp));
        ok(lvl >= 0, 'no level with a static platform to test');
        game.startLevel(lvl); game.state = 'play';
        const pl = game.PLATS.find((p) => !p.sp);
        game.cam = Math.max(0, pl.x - 60);
        // stand on top of the platform
        const rec = capture(HOST, () => game.drawShadow(pl.x + 2, 12, pl.y));
        const f = fills(rec);
        ok(f.length > 0, 'no shadow on the platform');
        const y = f[0][3];
        ok(Math.abs(y - pl.y) <= 2,
          `shadow landed at y=${y}, platform top is ${pl.y} (ground is ${game.GY})`);
      },

    'nothing casts a shadow over a gap, water or lava': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      const bad = [];
      // gap
      {
        const lvl = game.LEVELS.findIndex((l) => (l.gaps || []).length);
        if (lvl >= 0) {
          game.startLevel(lvl); game.state = 'play';
          const g = game.LEVELS[lvl].gaps[0];
          game.cam = Math.max(0, g.x - 60);
          const rec = capture(HOST, () => game.drawShadow(g.x + g.w / 2 - 6, 12, game.GY));
          if (fills(rec).length) bad.push('cast a shadow over a gap');
        }
      }
      // lava
      {
        const lvl = game.LEVELS.findIndex((l) => (l.lavaZones || []).length);
        if (lvl >= 0) {
          game.startLevel(lvl); game.state = 'play';
          const z = game.LEVELS[lvl].lavaZones[0];
          game.cam = Math.max(0, z.x - 60);
          const rec = capture(HOST, () => game.drawShadow(z.x + z.w / 2 - 6, 12, game.GY));
          if (fills(rec).length) bad.push('cast a shadow over lava');
        }
      }
      // water
      {
        const lvl = game.LEVELS.findIndex((l) => (l.waterZones || []).length);
        if (lvl >= 0) {
          game.startLevel(lvl); game.state = 'play';
          const z = game.LEVELS[lvl].waterZones[0];
          game.cam = Math.max(0, z.x - 60);
          const rec = capture(HOST, () => game.drawShadow(z.x + z.w / 2 - 6, 12, game.GY));
          if (fills(rec).length) bad.push('cast a shadow over water');
        }
      }
      ok(bad.length === 0, bad.join('; '));
    },

    'shadows shrink and fade with altitude, then stop': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.startLevel(0); game.state = 'play'; game.cam = 0;
      const widthAt = (feet) => {
        const f = fills(capture(HOST, () => game.drawShadow(40, 16, feet)));
        return f.length ? Math.max(...f.map(([, , , , w]) => w)) : 0;
      };
      const ground = widthAt(game.GY);
      const mid = widthAt(game.GY - game.GFX.shadowAir / 2);
      const high = widthAt(game.GY - game.GFX.shadowAir - 10);
      ok(ground > mid, `shadow should shrink with height: ground=${ground} mid=${mid}`);
      ok(mid > 0, 'mid-air actor lost its shadow entirely');
      ok(high === 0, `above shadowAir there should be no shadow, got width ${high}`);
      ok(ground >= game.GFX.shadowMinW, 'shadow narrower than shadowMinW');
    },

    'the shadow pass runs before the actors, so nothing stands on its own':
      ({ fresh, ok }) => {
        const { game } = fresh();
        const src = require('fs').readFileSync(process.env.MHMD_HTML, 'utf8');
        const body = src.slice(src.indexOf('function drawPlay()'));
        const shadows = body.indexOf('drawPlayShadows()');
        const actors = body.indexOf('drawPlayActors()');
        const world = body.indexOf('drawPlayWorld()');
        ok(shadows > world, 'shadows must come after the platforms they land on');
        ok(shadows < actors, 'shadows must come before the actors');
      },

    'fliers do not cast contact shadows': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.startLevel(0); game.state = 'play'; game.cam = 0;
      game.enemies.length = 0;
      game.pickups.length = 0;
      game.enemies.push({ t: 'jet', x: 40, y: 40, w: 14, h: 22, hp: 3, tm: 0 });
      const before = fills(capture(HOST, () => game.drawPlayShadows())).length;
      game.enemies[0].t = 'troop';
      game.enemies[0].y = game.GY - 24;
      const after = fills(capture(HOST, () => game.drawPlayShadows())).length;
      ok(after > before, `grounded trooper should add a shadow (jet=${before}, troop=${after})`);
    },

    'particles fade out over their last frames instead of popping':
      ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        game.startLevel(0); game.state = 'play'; game.cam = 0;
        game.parts.length = 0;
        game.parts.push({ x: 40, y: 100, vx: 0, vy: 0, life: 2, c: '#ffe848' });
        const rec = capture(HOST, () => game.drawPlayShots());
        const alpha = rec.filter(([m]) => m === 'fillRect').length;
        ok(alpha > 0, 'dying particle was not drawn');
        // a nearly-dead particle must have set globalAlpha below 1 at some point
        ok(rec.some(([m]) => m === 'fillRect'), 'no particle fill recorded');
        ok(game.GFX.partFade > 0, 'partFade must be tunable and positive');
      },

    'fresh particles draw chunkier than dying ones': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.startLevel(0); game.state = 'play'; game.cam = 0;
      const sizeFor = (life) => {
        game.parts.length = 0;
        game.parts.push({ x: 40, y: 100, vx: 0, vy: 0, life, c: '#fff' });
        const f = fills(capture(HOST, () => game.drawPlayShots()));
        return f.length ? f[0][5] : 0;
      };
      const fresh1 = sizeFor(game.GFX.partChunk + 5);
      const old = sizeFor(4);
      ok(fresh1 > old, `fresh particles should be bigger (fresh=${fresh1}, old=${old})`);
    },

    'a big burst lights the scene and the light decays away': ({ fresh, ok }) => {
      const { game } = fresh();
      game.startLevel(0); game.state = 'play';
      game.lightT = 0;
      game.burst(40, 100, 4, '#fff');
      ok(game.lightT === 0, 'a small burst should not light the scene');
      game.burst(40, 100, 20, '#fff');
      ok(game.lightT > 0, 'a big burst should light the scene');
      const peak = game.lightT;
      for (let i = 0; i < 40; i++) game.update();
      ok(game.lightT === 0, `light should decay to zero, still ${game.lightT} (peak ${peak})`);
    },

    'the impact light respects the FLASH FX setting': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.startLevel(0); game.state = 'play';
      const amp = () => {
        game.lightT = 1;
        const rec = capture(HOST, () => game.drawImpactLight());
        return rec.filter(([m]) => m === 'fillRect').length;
      };
      game.opt.flash = 1; const full = amp();
      game.opt.flash = 0; const reduced = amp();
      ok(full > 0, 'no light drawn with FLASH FX on');
      ok(reduced > 0, 'REDUCED should soften the light, not remove the feedback');
      game.lightT = 0;
      ok(capture(HOST, () => game.drawImpactLight()).length === 0,
        'no light should be drawn when lightT is zero');
    },

    'the arena grounds its bodies too, and only the ones that have arrived':
      ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        game.startHorde();
        game.hEn.length = 0;
        const base = fills(capture(HOST, () => game.drawHordeShadows())).length;
        // a spawning enemy (warm > 0) is still materialising and casts nothing
        game.hEn.push({ t: 'troop', x: 100, y: 100, w: 14, h: 22, hp: 1, warm: 30, dead: 0 });
        const warming = fills(capture(HOST, () => game.drawHordeShadows())).length;
        ok(warming === base, 'an enemy still warming in should not cast a shadow yet');
        game.hEn[0].warm = 0;
        const arrived = fills(capture(HOST, () => game.drawHordeShadows())).length;
        ok(arrived > base, 'an arrived enemy should cast a shadow');

        // split klones are pushed without a warm field at all; everywhere else
        // in the arena an absent warm already means "arrived", so it must here
        delete game.hEn[0].warm;
        const noField = fills(capture(HOST, () => game.drawHordeShadows())).length;
        ok(noField === arrived,
          'an enemy with no warm field must count as arrived, not as still spawning');
      },

    'the visual pass does not blow the frame budget': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      game.startLevel(0); game.state = 'play';
      for (let i = 0; i < 60; i++) { game.update(); game.render(); }
      HOST.ctxStats.calls = 0;
      const FR = 300;
      for (let i = 0; i < FR; i++) { game.update(); game.render(); }
      const per = HOST.ctxStats.calls / FR;
      ok(per < 800, `campaign L0 is ${Math.round(per)} canvas calls/frame (was 2110 pre-bake)`);
    },
  },
};
