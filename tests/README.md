# MHMD test harness

Headless. No browser, no GPU, no network, no dependencies — same constraints as the game itself.

```
node tests/run.js              # every suite
node tests/run.js voice save   # only suites whose filename matches
```

Exit code is the number of failures. **Failing tests are expected right now** — they encode the
findings in [`../AUDIT.md`](../AUDIT.md) and are meant to go green as those are fixed.

## Layout

| File | What it is |
|---|---|
| `shim.js` | Fake DOM, Canvas 2D, Web Audio, `localStorage`, window metrics, event registry |
| `load.js` | Extracts the `<script>` block from `index.html` and runs it in a `vm` sandbox, exposing the game's top-level bindings for assertions |
| `run.js` | Runner + assertion helpers |
| `suites/*.js` | The suites |

## Design rules

These come from bugs that actually shipped. Please keep them.

- **Unknown element IDs return `null`.** The registry is parsed from the real `id="…"` attributes in
  `index.html`. The old shim fabricated an element for any ID, which is why
  `getElementById('game')` — the canvas is `'cv'` — went unnoticed until every tap threw.
- **Test through real events.** `addEventListener` is a live registry. Use
  `HOST.dispatch('pointerdown', {clientX, clientY, pointerId})`, `HOST.tapCanvas(x, y)` and
  `HOST.key('z')` rather than poking internals — an earlier shim stubbed `addEventListener` as a
  no-op, so no pointer handler was ever actually tested.
- **Reset `stopT` before single-frame assertions.** Hitstop freezes the update loop for a few frames
  after a kill; without resetting you silently assert during the freeze.
- **Don't monkeypatch entities.** `bullets`/`enemies`/`parts` are rebuilt with `.filter()` every
  frame, so a patched instance does not survive. Use `WeakSet` identity tracking.
- **Never pin `VER`.** It changes every build.

## Harness API

```js
const { game, HOST } = api.fresh();   // fresh module + fresh localStorage per test

HOST.frames(n)              // run n real requestAnimationFrame ticks
HOST.music(seconds)         // advance the fake AudioContext clock, pump the 25ms scheduler
HOST.dispatch(type, ev)     // fire at document + window
HOST.tapCanvas(x, y, ev)    // pointerdown at native 256x224 coords
HOST.releaseCanvas(x, y)    // pointerup
HOST.key(k, down)           // keydown/keyup
HOST.elements.get('dp')     // inspect an element (e.g. .style.display)
HOST.store                  // the localStorage Map
HOST.ctxStats               // { calls, byMethod } — canvas call counting for perf work
```

`game` is a live view of the game's top-level bindings: `game.state`, `game.P`, `game.SAVE`,
`game.update()`, `game.render()`, and so on. Writes go back into the sandbox, so
`game.state = 'menu'` works.

## Adding a suite

```js
module.exports = {
  name: 'thing under test',
  tests: {
    'reads like a sentence': ({ fresh, eq, ok, notThrows }) => {
      const { game } = fresh();
      game.startLevel(0);
      eq(game.state, 'play');
    },
    'SKIP not ready yet': () => {},   // prefix with SKIP to skip
  },
};
```

## Gaps worth filling next

- MK-II weapon upgrade/downgrade rules (pick up the same weapon twice; lose the tier on a swap)
- `pickMech()` rotation invariant — no chassis repeats until all six are beaten
- Hostage-rescue hit priority (captor over hostage)
- Checkpoint/continue score and secret preservation
