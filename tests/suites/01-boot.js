/* Boot integrity — the failure modes from "bug archaeology" #1, #2 and #7. */
'use strict';
module.exports = {
  name: 'boot & globals',
  tests: {
    'file loads with no temporal-dead-zone crash': ({ fresh, ok }) => {
      const { game } = fresh();
      ok(game.VER, 'VER should be defined after load');
    },

    'every world array is initialised at declaration, not on level start': ({ fresh, ok }) => {
      const { game } = fresh();
      // Archaeology #1: these were assigned only when a campaign level started,
      // so entering the Gallery straight from boot left them undefined and the
      // music engine threw inside setInterval at step 96.
      for (const k of ['bullets', 'ebul', 'enemies', 'pickups', 'parts', 'decals', 'spawnQ', 'hEn', 'hEb', 'hPk']) {
        ok(Array.isArray(game[k]), k + ' must be an array at boot, got ' + typeof game[k]);
      }
      ok(game.P === null, 'P should be explicitly null at boot');
      ok(game.boss === null, 'boss should be explicitly null at boot');
    },

    'unknown element IDs return null (harness must not fabricate them)': ({ fresh, ok }) => {
      const { HOST } = fresh();
      ok(HOST.document.getElementById('game') === null,
        "getElementById('game') must be null — fabricating it masked archaeology #2");
      ok(HOST.document.getElementById('cv') !== null, "getElementById('cv') must exist");
    },

    'boot runs 600 frames on the splash screen without throwing': ({ fresh, notThrows }) => {
      const { HOST } = fresh();
      notThrows(() => HOST.frames(600));
    },

    'content tables are populated': ({ fresh, ok, eq }) => {
      const { game } = fresh();
      eq(game.LEVELS.length, 9, 'campaign sectors');
      eq(game.MECHROSTER.length, 6, 'mech chassis');
      eq(game.GLV.length, 4, 'rail-shooter ops');
      ok(Object.keys(game.WPN).length >= 15, 'armory size');
      ok(game.ACH.length >= 25, 'achievements');
      eq(game.WPNKEYS.length, Object.keys(game.WPN).length, 'WPNKEYS mirrors WPN');
    },
  },
};
