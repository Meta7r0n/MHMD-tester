/* Voice rule (non-negotiable, per the handoff — enforced twice already):
   German-accented dialogue is VILLAIN-ONLY. Player characters, allies and
   narration are plain American English.

   This suite checks the narration channels only — HUD banners and achievement
   names, which are the game talking to the player in its own voice. Boss
   dialogue tables are deliberately NOT scanned: that is where the accent
   belongs.                                                                  */
'use strict';
const fs = require('fs');

const ACCENT = /\b(ZE|ZIS|ZAT|ZEY|ZEIR|ZERE|ZESE|ZOSE|ZEN|ZINK|MEIN|VAS|VE|VELCOME|VILL|VHAT|VHO|VORLD|VEEKS|UND|ZER|ACHTUNG|SCHNELL|DUMMKOPF|VERDAMMT|VUNDERBAR)\b/;

/* A line that names or quotes a villain is dialogue, not narration. THE JAR is
   Ego Prime's brain-in-a-jar finale, so it speaks with the accent by design. */
const QUOTES_VILLAIN = /(EGO PRIME|MECHA HITLER|UBER-BOOT|REICHSADLER|DIE GLOCKE|WERWOLF|HYDRA|HEAD \d|LOCO-F|FROST F|KOMMANDANT|KLONE|CAPTOR|THE JAR|MK-)/i;

function readSrc() {
  return fs.readFileSync(process.env.MHMD_HTML, 'utf8');
}
/* Pull EVERY string literal out of a call, not just a bare first argument —
   the accented banners hide inside concatenations and ternaries:
     galBan('CHECKPOINT '+n+' · BACK IN ZE FIGHT', 120)
     galBan(b.stage===2 ? 'STAGE 2: ZE SKELETAL FRAME' : '...', 120)      */
function literalsOf(src, callName) {
  const out = [];
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, '');
    if (!code.includes(callName + '(')) return;
    const from = code.indexOf(callName + '(');
    for (const m of code.slice(from).matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
      const s = m[1] !== undefined ? m[1] : m[2];
      if (s && s.length > 2) out.push({ ln: i + 1, s, line: code.trim() });
    }
  });
  return out;
}

module.exports = {
  name: 'voice rule (accent is villain-only)',
  tests: {
    'HUD banners in the rail shooter are plain English': ({ ok }) => {
      const src = readSrc();
      const bad = literalsOf(src, 'galBan')
        .filter((b) => ACCENT.test(b.s.toUpperCase()) && !QUOTES_VILLAIN.test(b.line))
        .map((b) => `index.html:${b.ln}  "${b.s}"`);
      ok(bad.length === 0,
        'accented narration in galBan() — every sibling banner ("THE FRAME COLLAPSES!", ' +
        '"DIVE INCOMING - TAKE COVER!") is plain English:\n        ' + bad.join('\n        '));
    },

    'showLine() narration is plain English unless it quotes a villain': ({ ok }) => {
      const src = readSrc();
      const bad = literalsOf(src, 'showLine')
        .filter((b) => ACCENT.test(b.s.toUpperCase()) && !QUOTES_VILLAIN.test(b.line))
        .map((b) => `index.html:${b.ln}  "${b.s}"`);
      ok(bad.length === 0, 'accented narration in showLine():\n        ' + bad.join('\n        '));
    },

    'achievement names and descriptions are plain English': ({ fresh, ok }) => {
      const { game } = fresh();
      const bad = [];
      for (const a of game.ACH) {
        for (const field of ['n', 'd']) {
          const v = a[field];
          if (v && ACCENT.test(String(v).toUpperCase())) bad.push(`${a.id}.${field} = "${v}"`);
        }
      }
      ok(bad.length === 0,
        'accented achievement text (the Achievements screen is narration):\n        ' +
        bad.join('\n        '));
    },

    'playable character names, bios and perk tags are plain English':
      ({ fresh, ok }) => {
        const { game } = fresh();
        game.SAVE.ach.horde5 = 1; game.SAVE.ach.galall = 1; game.syncChars();
        game.applyShop('gutpunch');
        const bad = [];
        for (const c of game.CHARS)
          for (const f of ['name', 'bio', 'tag'])
            if (c[f] && ACCENT.test(String(c[f]).toUpperCase()))
              bad.push(`${c.name}.${f} = "${c[f]}"`);
        ok(bad.length === 0, 'accented player-character text:\n        ' + bad.join('\n        '));
      },

    'pickup and kill-quip tables are plain English': ({ fresh, ok }) => {
      const { game } = fresh();
      const bad = [];
      game.LINES.forEach((l, i) => {
        // SIEG NEIN! is a deliberate subversion pun — see the open question in the audit
        if (/NEIN/.test(l)) return;
        if (ACCENT.test(l.toUpperCase())) bad.push(`LINES[${i}] = "${l}"`);
      });
      ok(bad.length === 0, 'accented kill quips:\n        ' + bad.join('\n        '));
    },

    'the mode name is spelled consistently everywhere': ({ fresh, ok }) => {
      const { game } = fresh();
      const canonical = game.GALNAME;               // 'THE SHOOTING ALLY'
      const drift = game.ACH
        .filter((a) => /SHOOTING ALLY/i.test(a.n) && a.n !== canonical)
        .map((a) => `${a.id}.n = "${a.n}" (canonical: "${canonical}")`);
      ok(drift.length === 0, 'mode name drift:\n        ' + drift.join('\n        '));
    },
  },
};
