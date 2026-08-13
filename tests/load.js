/* Loads the game's <script> block into a vm sandbox on top of shim.js.
   Exposes { game, HOST } so suites can poke real globals and dispatch real events. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const { HOST, G } = require('./shim.js');

function loadGame(htmlPath) {
  const html = fs.readFileSync(htmlPath || process.env.MHMD_HTML || 'index.html', 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script> block found');
  const src = m[1];

  const ctx = vm.createContext(G);
  // 'use strict' at the top of the game means top-level let/const land in the
  // script's own lexical scope, not on the sandbox object. Wrap so we can read
  // them back out for assertions.
  // Collect top-level binding names. Multi-declarator lines like
  //   let P=null, bullets=[], ebul=[], boss=null, spawnQ=[];
  // need depth-aware scanning: a name is an identifier sitting at bracket
  // depth 0 immediately after `let/const/var` or after a depth-0 comma.
  const names = [];
  const lines = src.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const kw = line.match(/^(?:let|const|var)\s+/);
    if (!kw) continue;
    // join continuation lines until the statement's semicolon at depth 0
    let stmt = line, depth = 0, done = false;
    const scan = (s) => {
      for (const ch of s) {
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        else if (ch === ';' && depth <= 0) return true;
      }
      return false;
    };
    done = scan(line);
    let j = li;
    while (!done && j + 1 < lines.length && j - li < 12) {
      j++; stmt += '\n' + lines[j]; done = scan(lines[j]);
    }
    let d = 0, expectName = true, buf = '';
    const body = stmt.replace(/^(?:let|const|var)\s+/, '');
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if ('([{'.includes(ch)) { d++; continue; }
      if (')]}'.includes(ch)) { d--; continue; }
      if (d === 0 && expectName && /[A-Za-z0-9_$]/.test(ch)) { buf += ch; continue; }
      if (buf) {
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(buf)) names.push(buf);
        buf = ''; expectName = false;
      }
      if (d === 0 && ch === ',') expectName = true;
      if (d === 0 && ch === ';') break;
    }
    if (buf && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(buf)) names.push(buf);
  }
  for (const mm of src.matchAll(/^function\s+([A-Za-z0-9_$]+)/gm)) names.push(mm[1]);
  const uniq = Array.from(new Set(names));

  const exporter = '\n;globalThis.__G={' +
    uniq.map((n) => `get ${n}(){return ${n};},set ${n}(v){${n}=v;}`).join(',') +
    '};\n';

  const script = new vm.Script(src + exporter, { filename: 'game.js' });
  script.runInContext(ctx);
  return { game: ctx.__G, ctx, HOST, src };
}

module.exports = { loadGame, HOST };
