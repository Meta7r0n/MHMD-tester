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

    /* The pads are hidden for the whole of an Op (the rail shooter owns every
       touch) and must come back the moment we are anywhere else — otherwise the
       player is left on a phone with no controls at all. */
    'the touch pads track the mode: hidden inside an Op, visible outside it':
      ({ fresh, ok }) => {
        const PADS = ['dp', 'bA', 'bB', 'bX', 'bY', 'bP'];
        const hiddenNow = (HOST) => PADS.filter((id) => HOST.elements.get(id).style.display === 'none');

        // resuming out of pause keeps us in the Op, so they stay hidden
        {
          const { game, HOST } = fresh();
          enterAlly(game);
          pauseNow(game);
          game.tap = { ...OFF_MENU_TAP };
          game.update();
          ok(game.state === 'gal', 'expected to resume into the Op, got ' + game.state);
          ok(hiddenNow(HOST).length === PADS.length, 'pads should stay hidden while in an Op');
        }
        // quitting to the menu must give them back
        {
          const { game, HOST } = fresh();
          enterAlly(game);
          pauseNow(game);
          game.pauseSel = game.PAUSE_ITEMS.findIndex((p) => p.k === 'quit');
          game.keys.fire = 1; game.PK = {}; game.update();
          ok(game.state === 'menu', 'expected the menu, got ' + game.state);
          const still = hiddenNow(HOST);
          ok(still.length === 0, 'still hidden after quitting to the menu: ' + still.join(','));
        }
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
