/* Cross-mode state leaks. The pause menu is shared by all three modes and is
   the one screen that can hand control back to the WRONG mode.             */
'use strict';

function enterAlly(game) {
  game.SAVE.gal = { prog: 3, best: [0, 0, 0, 0], sec: [0, 0, 0, 0] };
  game.galMode = 1;
  game.galResetLvl(0);
}
function pauseNow(game) {
  game.keys.pause = 1; game.PK = {}; game.update(); game.keys.pause = 0; game.PK = {};
}
/* y past the last pause row: rows start at 56 with 13px pitch, 10 items */
const OFF_MENU_TAP = { x: 128, y: 210 };

module.exports = {
  name: 'mode isolation (pause menu)',
  tests: {
    'pause from the rail shooter returns to the rail shooter, not the campaign':
      ({ fresh, eq }) => {
        const { game } = fresh();
        enterAlly(game);
        pauseNow(game);
        eq(game.pauseRet, 'gal', 'pauseRet recorded the origin mode');
        game.tap = { ...OFF_MENU_TAP };
        game.update();
        eq(game.state, 'gal', 'tapping outside the pause rows must honour pauseRet');
      },

    'pause from horde returns to horde, not the campaign': ({ fresh, eq }) => {
      const { game } = fresh();
      game.startHorde();
      pauseNow(game);
      eq(game.pauseRet, 'horde');
      game.tap = { ...OFF_MENU_TAP };
      game.update();
      eq(game.state, 'horde', 'tapping outside the pause rows must honour pauseRet');
    },

    'leaving pause from the rail shooter never lands on a null player':
      ({ fresh, notThrows }) => {
        const { game } = fresh();
        enterAlly(game);           // straight from boot: no campaign, so P === null
        pauseNow(game);
        game.tap = { ...OFF_MENU_TAP };
        game.update();
        notThrows(() => { game.PK = {}; game.update(); game.render(); },
          'frame after leaving pause crashed on a null P');
      },

    'the touch pads are restored whenever the rail shooter is left':
      ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        enterAlly(game);
        pauseNow(game);
        game.tap = { ...OFF_MENU_TAP };
        game.update();
        const hidden = ['dp', 'bA', 'bB', 'bX', 'bY', 'bP']
          .filter((id) => HOST.elements.get(id).style.display === 'none');
        ok(hidden.length === 0,
          'still hidden after leaving the rail shooter: ' + hidden.join(',') +
          ' — on touch the player has no controls at all');
      },

    'RESUME row honours pauseRet (control case — this one is already right)':
      ({ fresh, eq }) => {
        const { game } = fresh();
        enterAlly(game);
        pauseNow(game);
        game.tap = { x: 128, y: 58 };   // row 0 = RESUME
        game.update();
        eq(game.state, 'gal');
      },

    'entering an Op clears any pending hitstop': ({ fresh, eq }) => {
      const { game } = fresh();
      game.SAVE.gal = { prog: 3, best: [0, 0, 0, 0], sec: [0, 0, 0, 0] };
      game.stopT = 9;                 // a kill in another mode left hitstop pending
      game.galResetLvl(0);
      eq(game.stopT, 0, 'galResetLvl should reset stopT like startHorde/startLevel do');
    },

    'startHorde and startLevel clear pending hitstop (control cases)':
      ({ fresh, eq }) => {
        const { game } = fresh();
        game.stopT = 9; game.startHorde(); eq(game.stopT, 0, 'startHorde');
        game.stopT = 9; game.startLevel(0); eq(game.stopT, 0, 'startLevel');
      },
  },
};
