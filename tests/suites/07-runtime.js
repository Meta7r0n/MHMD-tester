/* Broad runtime sweep: drive every mode through REAL dispatched events and
   assert nothing throws. This is the net that catches the next "Script error."  */
'use strict';

const KEYS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'z', 'enter', 'c', 'v', 'p'];

function makeRng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function sweep(game, HOST, frames, rnd, touch) {
  const errs = [];
  for (let i = 0; i < frames; i++) {
    if (rnd() < 0.3) HOST.dispatch(rnd() < 0.5 ? 'keydown' : 'keyup', { key: KEYS[(rnd() * KEYS.length) | 0] });
    if (touch) {
      const pid = 1 + ((rnd() * 3) | 0);
      if (rnd() < 0.35) HOST.tapCanvas(rnd() * 256, rnd() * 224, { pointerId: pid });
      if (rnd() < 0.30) HOST.dispatch('pointermove', { clientX: rnd() * 256, clientY: rnd() * 224, pointerId: pid });
      if (rnd() < 0.30) HOST.releaseCanvas(rnd() * 256, rnd() * 224, { pointerId: pid });
    }
    try { game.update(); } catch (e) { errs.push('update@' + game.state + ': ' + e.message); }
    try { game.render(); } catch (e) { errs.push('render@' + game.state + ': ' + e.message); }
    if (errs.length > 3) break;
  }
  return [...new Set(errs)];
}

function unlockAll(game) {
  game.SAVE.wins = 3; game.SAVE.prog = 9; game.SAVE.gold = 9999; game.SAVE.lifeGold = 9999;
  game.SAVE.ach.beat1 = 1; game.SAVE.ach.horde5 = 1; game.SAVE.ach.galall = 1;
  game.SAVE.gal = { prog: 3, best: [9, 9, 9, 9], sec: [9, 9, 9, 9] };
  game.syncChars();
}

module.exports = {
  name: 'runtime sweep',
  tests: {
    'every campaign sector survives 3000 fuzzed frames': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      unlockAll(game);
      const rnd = makeRng(11);
      const bad = [];
      for (let L = 0; L < game.LEVELS.length; L++) {
        game.startLevel(L); game.state = 'play';
        const e = sweep(game, HOST, 3000, rnd, false);
        if (e.length) bad.push('L' + L + ': ' + e.join(' | '));
      }
      ok(bad.length === 0, bad.join('\n        '));
    },

    'horde survives a fuzzed run through every wave': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      unlockAll(game);
      const rnd = makeRng(22);
      game.startHorde();
      const e = sweep(game, HOST, 20000, rnd, true);
      ok(e.length === 0, e.join('\n        '));
    },

    'all four Ops survive fuzzed multitouch in 1P and 2P': ({ fresh, ok }) => {
      const { game, HOST } = fresh();
      unlockAll(game);
      const rnd = makeRng(33);
      const bad = [];
      for (const mode of [1, 2]) {
        for (let op = 0; op < game.GLV.length; op++) {
          game.galMode = mode;
          game.galResetLvl(op);
          const e = sweep(game, HOST, 6000, rnd, true);
          if (e.length) bad.push(`op${op} ${mode}P: ` + e.join(' | '));
        }
      }
      ok(bad.length === 0, bad.join('\n        '));
    },

    /* The invariant that actually matters, checked on EVERY frame rather than
       by looking at where the fuzzer happened to wander: the campaign must
       never be running without a player. Judging by final state can't tell a
       leak apart from the fuzzer legitimately walking the menus into another
       mode, so it has to be sampled continuously. */
    'the campaign never runs without a player, however you got there':
      ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        unlockAll(game);
        const rnd = makeRng(44);
        const bad = [];
        const check = (where) => {
          if (game.state === 'play' && !game.P) bad.push(where + ': state=play with P=null');
        };
        for (let op = 0; op < game.GLV.length; op++) {
          game.galMode = 1; game.galResetLvl(op);
          for (let i = 0; i < 4000 && !bad.length; i++) {
            const KEYS2 = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'z', 'enter', 'c', 'v', 'p'];
            if (rnd() < 0.3) HOST.dispatch(rnd() < 0.5 ? 'keydown' : 'keyup', { key: KEYS2[(rnd() * 10) | 0] });
            const pid = 1 + ((rnd() * 3) | 0);
            if (rnd() < 0.35) HOST.tapCanvas(rnd() * 256, rnd() * 224, { pointerId: pid });
            if (rnd() < 0.30) HOST.releaseCanvas(rnd() * 256, rnd() * 224, { pointerId: pid });
            game.update(); check(`op${op} frame ${i} (after update)`);
            game.render();
          }
        }
        ok(bad.length === 0, bad.slice(0, 5).join('\n        '));
      },

    'pausing in any mode and un-pausing returns to that same mode':
      ({ fresh, ok }) => {
        const { game } = fresh();
        unlockAll(game);
        const bad = [];
        const enter = {
          gal: () => { game.galMode = 1; game.galResetLvl(0); },
          horde: () => game.startHorde(),
          play: () => { game.startLevel(0); game.state = 'play'; },
        };
        for (const [mode, go] of Object.entries(enter)) {
          for (const exit of ['key', 'tapOffMenu', 'resumeRow']) {
            go();
            game.keys.pause = 1; game.PK = {}; game.update(); game.keys.pause = 0; game.PK = {};
            if (game.state !== 'pause') { bad.push(`${mode}: could not pause`); continue; }
            if (exit === 'key') { game.keys.jump = 1; game.update(); game.keys.jump = 0; }
            if (exit === 'tapOffMenu') { game.tap = { x: 128, y: 210 }; game.update(); }
            if (exit === 'resumeRow') { game.tap = { x: 128, y: 58 }; game.update(); }
            if (game.state !== mode) bad.push(`${mode} + ${exit} → ${game.state}`);
          }
        }
        ok(bad.length === 0, bad.join('\n        '));
      },

    'frontend states render without a player object': ({ fresh, notThrows }) => {
      const { game } = fresh();
      for (const st of ['splash', 'intro', 'menu', 'charsel', 'vault', 'lvlsel', 'shop',
        'ach', 'depot', 'optmenu', 'sound', 'merch', 'credits', 'hboard', 'galsel']) {
        game.setState(st);
        notThrows(() => { game.PK = {}; game.update(); game.render(); }, st);
      }
    },
  },
};
