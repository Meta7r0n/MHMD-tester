#!/usr/bin/env node
/* MHMD test runner — headless, no browser, no GPU, no network.
     node tests/run.js              run every suite
     node tests/run.js menu save    run only suites whose name contains these
   Exit code is the number of failures (0 = green).                        */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.MHMD_HTML = process.env.MHMD_HTML || path.join(ROOT, 'index.html');

const filters = process.argv.slice(2);
const dir = path.join(__dirname, 'suites');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)));

let pass = 0, fail = 0, skipped = 0;
const failures = [];

const api = {
  /** fresh game instance — every test gets its own module + localStorage */
  fresh() {
    for (const k of ['./shim.js', './load.js']) {
      try { delete require.cache[require.resolve(k)]; } catch (e) {}
    }
    return require('./load.js').loadGame(process.env.MHMD_HTML);
  },
  eq(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a === b) return true;
    throw new Error((msg || 'eq') + `\n      expected: ${b}\n      actual:   ${a}`);
  },
  ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); },
  notThrows(fn, msg) {
    try { fn(); } catch (e) { throw new Error((msg || 'threw') + ': ' + e.message); }
  },
};

for (const f of files) {
  const suite = require(path.join(dir, f));
  const name = suite.name || f.replace(/\.js$/, '');
  console.log('\n• ' + name);
  for (const [label, fn] of Object.entries(suite.tests)) {
    if (label.startsWith('SKIP ')) { skipped++; console.log('    - ' + label); continue; }
    try {
      fn(api);
      pass++; console.log('    ✓ ' + label);
    } catch (e) {
      fail++; failures.push([name, label, e]);
      console.log('    ✗ ' + label);
      console.log('      ' + String(e.message).split('\n').join('\n      '));
    }
  }
}

console.log('\n' + '-'.repeat(58));
console.log(`  ${pass} passed, ${fail} failed${skipped ? ', ' + skipped + ' skipped' : ''}`);
if (fail) {
  console.log('\n  FAILING:');
  for (const [s, l] of failures) console.log('    ' + s + ' → ' + l);
}
process.exit(Math.min(fail, 250));
