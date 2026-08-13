/* Archaeology #6: "Pressing right on the d-pad called act() on menu rows in four
   separate screens." RIGHT was guarded afterwards. LEFT was not — these tests
   pin BOTH directions so the next fix cannot be half a fix.                */
'use strict';

function tapKey(game, k) { game.keys[k] = 1; game.PK = {}; game.update(); game.keys[k] = 0; }

module.exports = {
  name: 'menu input leak (d-pad must adjust, never enter)',
  tests: {
    'LEFT on the main menu never leaves the menu': ({ fresh, ok }) => {
      const leaked = [];
      for (let i = 0; i < 9; i++) {
        const { game } = fresh();
        game.state = 'menu'; game.stateT = 1; game.menuSel = i; game.cheatMode = false;
        const label = game.MENU[i].label();
        tapKey(game, 'l');
        if (game.state !== 'menu') leaked.push(`row ${i} "${label}" → ${game.state}`);
      }
      ok(leaked.length === 0, 'LEFT entered menu items:\n        ' + leaked.join('\n        '));
    },

    'RIGHT on the main menu never leaves the menu (control — already fixed)':
      ({ fresh, ok }) => {
        const leaked = [];
        for (let i = 0; i < 9; i++) {
          const { game } = fresh();
          game.state = 'menu'; game.stateT = 1; game.menuSel = i; game.cheatMode = false;
          tapKey(game, 'r');
          if (game.state !== 'menu') leaked.push('row ' + i);
        }
        ok(leaked.length === 0, 'RIGHT entered menu items: ' + leaked.join(', '));
      },

    'LEFT in Level Select never launches a sector': ({ fresh, eq }) => {
      const { game } = fresh();
      game.state = 'lvlsel'; game.stateT = 1; game.lvlSel = 0;
      tapKey(game, 'l');
      eq(game.state, 'lvlsel', 'LEFT launched the sector');
    },

    'RIGHT in Level Select never launches a sector (control — already fixed)':
      ({ fresh, eq }) => {
        const { game } = fresh();
        game.state = 'lvlsel'; game.stateT = 1; game.lvlSel = 0;
        tapKey(game, 'r');
        eq(game.state, 'lvlsel');
      },

    'LEFT in the pause menu never fires RESUME / RESTART / QUIT': ({ fresh, ok }) => {
      const leaked = [];
      for (let i = 0; i < 10; i++) {
        const { game } = fresh();
        game.startLevel(0);
        game.state = 'pause'; game.stateT = 1; game.pauseSel = i; game.pauseRet = 'play';
        const k = game.PAUSE_ITEMS[i].k;
        tapKey(game, 'l');
        if (game.state !== 'pause') leaked.push(`${k} → ${game.state}`);
      }
      ok(leaked.length === 0, 'LEFT fired destructive pause rows: ' + leaked.join(', '));
    },

    'LEFT in a sub-list (Options/Depot/Merch) never activates a row':
      ({ fresh, ok }) => {
        const leaked = [];
        for (const st of ['optmenu', 'depot', 'merch', 'hboard', 'galsel']) {
          const { game } = fresh();
          game.SAVE.gal = { prog: 3, best: [0, 0, 0, 0], sec: [0, 0, 0, 0] };
          game.state = st; game.stateT = 1; game.subSel = 0;
          tapKey(game, 'l');
          if (game.state !== st) leaked.push(`${st} → ${game.state}`);
        }
        ok(leaked.length === 0, 'LEFT activated sub-list rows: ' + leaked.join(', '));
      },

    'the "post" screen advances stateT exactly once per frame': ({ fresh, eq }) => {
      const { game } = fresh();
      game.setState('post');
      const t0 = game.stateT;
      game.PK = {}; game.update();
      eq(game.stateT - t0, 1, 'stateT is incremented twice (updateFrontend head + post branch)');
    },
  },
};
