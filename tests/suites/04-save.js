/* Save migration: every historical schema must normalise without producing
   `undefined` anywhere the UI will read.                                   */
'use strict';

const HISTORICAL = {
  'empty object': {},
  'v1 vault only': { total: 40, best: [1, 2, 3] },
  'pre-horde (no mechs/hboard)': { gold: 10, lifeGold: 99, best: [5], kills: 3, prog: 2, ach: { beat1: 1 } },
  'pre-gallery (no gal)': { gold: 1, best: [0], mechs: { mk1: 2 }, hboard: [{ c: 'DUKE', w: 4, s: 900 }] },
  'gal present but short arrays': { best: [0], gal: { prog: 1, best: [7], sec: [1] } },
  'gal fields wrong type': { best: [0], gal: { prog: 'x', best: null, sec: 5 } },
  'nulls everywhere': { best: [0], mechs: null, hboard: null, ach: null, own: null, tele: null },
  'tele overflow': { best: [0], tele: Array.from({ length: 500 }, (z, i) => ({ s: i % 9, x: i, c: 'A', w: 'PEA' })) },
};

module.exports = {
  name: 'save migration',
  tests: {
    'fixSave normalises every historical schema with no undefined fields':
      ({ fresh, ok }) => {
        const { game } = fresh();
        const bad = [];
        for (const [label, raw] of Object.entries(HISTORICAL)) {
          const s = game.fixSave(raw);
          for (const k of ['gold', 'lifeGold', 'best', 'kills', 'deaths', 'wins', 'prog',
            'tele', 'hboard', 'mechs', 'gal', 'ach', 'own']) {
            if (s[k] === undefined || s[k] === null) bad.push(`${label}.${k}`);
          }
          if (!Array.isArray(s.gal.best) || !Array.isArray(s.gal.sec)) bad.push(label + '.gal arrays');
          if (typeof s.gal.prog !== 'number' || Number.isNaN(s.gal.prog)) bad.push(label + '.gal.prog');
          if (s.tele.length > 200) bad.push(label + '.tele not capped');
        }
        ok(bad.length === 0, 'undefined/invalid after migration: ' + bad.join(', '));
      },

    'a migrated save survives a full frontend render in every menu state':
      ({ fresh, notThrows }) => {
        const { game } = fresh();
        for (const [label, raw] of Object.entries(HISTORICAL)) {
          Object.assign(game.SAVE, game.fixSave(raw));
          game.syncChars();
          for (const st of ['menu', 'depot', 'optmenu', 'hboard', 'galsel', 'ach', 'vault', 'shop', 'lvlsel', 'charsel']) {
            game.setState(st);
            notThrows(() => { game.PK = {}; game.update(); game.render(); }, `${label} @ ${st}`);
          }
        }
      },

    'gal progress arrays are sized from the Op table, not a hardcoded 4':
      ({ fresh, eq, ok }) => {
        const { game } = fresh();
        const s = game.fixSave({});
        ok(s.gal.best.length >= game.GLV.length,
          `gal.best has ${s.gal.best.length} slots for ${game.GLV.length} Ops — adding a 5th Op silently breaks the leaderboard`);
        ok(s.gal.sec.length >= game.GLV.length,
          `gal.sec has ${s.gal.sec.length} slots for ${game.GLV.length} Ops`);
      },

    /* Driven through the real vault screen — export to the clipboard, wipe the
       roster, then import — rather than replaying a copy of the guard. */
    'importing a save grants GUTPUNCH even after both unlockables are earned':
      async ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        game.SAVE.own.gutpunch = 1;                 // bought for 100 gold
        game.SAVE.ach.horde5 = 1;                   // CPL. PUNISHMENT
        game.SAVE.ach.galall = 1;                   // DEAD-EYE DOTTIE

        game.setState('vault');
        game.keys.act = 1; game.PK = {}; game.update(); game.keys.act = 0;   // X: export
        await Promise.resolve();
        ok(HOST.clipboard.startsWith('MHMD1.'), 'export did not reach the clipboard');

        game.syncChars();                           // both unlockables folded in -> CHARS.length 6
        ok(game.CHARS.length >= 6, 'expected 6 operatives, got ' + game.CHARS.length);
        const i = game.CHARS.indexOf(game.GUTPUNCH);
        if (i >= 0) game.CHARS.splice(i, 1);        // simulate a fresh device

        game.setState('vault');
        game.keys.inv = 1; game.PK = {}; game.update(); game.keys.inv = 0;   // Y: import
        await new Promise((r) => setImmediate(r));  // let the clipboard promise settle

        ok(game.CHARS.includes(game.GUTPUNCH),
          'owned GUTPUNCH was dropped on import — the roster came back without the ' +
          'character the player paid for');
      },

    'lifetime counters never go NaN through a bank + migrate cycle':
      ({ fresh, ok }) => {
        const { game } = fresh();
        Object.assign(game.SAVE, game.fixSave({ best: [0] }));
        game.LVL = 0; game.runGold = 5; game.runKills = 3; game.runDeaths = 1;
        game.bankGold();
        const s = game.fixSave(game.SAVE);
        for (const k of ['gold', 'lifeGold', 'kills', 'deaths', 'prog'])
          ok(Number.isFinite(s[k]), k + ' became ' + s[k]);
      },
  },
};
