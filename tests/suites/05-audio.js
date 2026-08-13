/* Archaeology #1's real victim was the music engine: playStep read
   `enemies.length` from inside a 25ms setInterval, so one undefined global
   killed the band permanently while SFX kept working.                      */
'use strict';

const ALL_STATES = ['splash', 'intro', 'menu', 'charsel', 'vault', 'lvlsel', 'shop', 'ach',
  'depot', 'optmenu', 'sound', 'merch', 'credits', 'hboard', 'galsel', 'play', 'horde',
  'gal', 'galwin', 'galover', 'hwin', 'hover', 'over', 'win', 'pause', 'post'];

module.exports = {
  name: 'audio scheduler',
  tests: {
    'the scheduler survives 60s in every state, straight from boot':
      ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        game.initAudio();
        for (const st of ALL_STATES) {
          game.state = st;
          HOST.music(60);
        }
        ok(!game.schedMusic.warned,
          'a music step threw — schedMusic.warned is set, so the band died silently');
        ok(game.mStep > 1000, 'scheduler did not advance (mStep=' + game.mStep + ')');
      },

    'the adaptive solo line reads world arrays that exist at boot':
      ({ fresh, notThrows }) => {
        const { game, HOST } = fresh();
        game.initAudio();
        // step 96 of the metal engine is the historical crash point: the solo
        // section checks enemies.length / hEn.length / boss without a level loaded.
        game.state = 'play';
        notThrows(() => { for (let s = 0; s < 400; s++) game.playStep(s, s * 0.05); },
          'playStep threw with no level loaded');
      },

    'curBPM returns a usable tempo in every state': ({ fresh, ok }) => {
      const { game } = fresh();
      const bad = [];
      for (const st of ALL_STATES) {
        game.state = st;
        const b = game.curBPM();
        if (!Number.isFinite(b) || b <= 0) bad.push(st + '=' + b);
      }
      ok(bad.length === 0, 'bad BPM: ' + bad.join(', '));
    },

    'entering the rail shooter from a cold boot does not kill the music':
      ({ fresh, ok }) => {
        const { game, HOST } = fresh();
        game.initAudio();
        game.SAVE.gal = { prog: 3, best: [0, 0, 0, 0], sec: [0, 0, 0, 0] };
        game.galResetLvl(0);           // no campaign has ever run
        HOST.music(30);
        ok(!game.schedMusic.warned, 'music threw after a cold entry into the Gallery');
      },
  },
};
