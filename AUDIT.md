# MECHA HITLER MUST DIE! — code audit

**Audited:** `index.html` · 7,216 lines · 311 KB · single self-contained file
**Method:** full read + a headless Node harness (`tests/`) that drives the real code through real
dispatched events. Every finding below marked **verified** has a reproducing test in `tests/suites/`.

> **Status — all findings below are now fixed on `claude/c-v0-40-alpha-baseline`.**
> `node tests/run.js` → **51 passed, 0 failed**. Build is **v0.40-ALPHA**.
> Left alone by request, still open: `NEWTON'S NEIN`, `SIEG NEIN!`, `ZE FINAL CURTAIN`
> (see [Open questions](#open-questions-for-you)) and the `index.html` filename question.
> This document is kept as the record of what was found and why it mattered.

---

## 0. First, the good news

The bug classes from the archaeology list have genuinely been fixed, and I verified each one rather
than taking it on trust:

| # | Historical bug | Status |
|---|---|---|
| 1 | Conditionally-initialized globals killing the music engine | **Fixed.** All world arrays initialized at declaration (`:1355`). Scheduler survives 60 s in all 26 states from a cold boot — including entering the Gallery first, the original repro. |
| 2 | `galCanvasXY` looking up the wrong element ID | **Fixed.** Uses the `cv` binding directly (`:211`). My harness returns `null` for unknown IDs, so a regression here would throw immediately. |
| 3 | Sniper `rad: -3` shrinking the hitbox | **Fixed.** `rad: 4`, `assist: 20` (`:1510`). See P3-1 for the leftover trap. |
| 4 | Civilians/barrels inheriting the enemy `'pop'` state | **Fixed.** `galSpawn` assigns per-kind states (`:1537-1541`). |
| 5 | Same-frame boss resurrection | **Fixed.** No reproduction across 48,000 fuzzed rail-shooter frames. |
| 6 | Menu input leak via the d-pad | **Half fixed.** RIGHT was guarded in all four screens; LEFT was not. See **P1-1**. |
| 7 | Temporal dead zone at file load | **Fixed.** Loads clean. |
| 8 | Cache/shipping hazard | **Live problem.** See **P1-2**. |

**Dead code: none.** Every one of the 236 functions is reachable, and every enemy type, weapon and
state in the data tables is wired to something. That is unusual at this size and worth keeping.

---

## P0 — Critical

### P0-1 · Leaving the pause menu drops you into the campaign from *any* mode — hard crash from the rail shooter

**`index.html:3132`** · verified · `tests/suites/02-mode-isolation.js`

```js
if(tap){
  const i=Math.floor((tap.y-56)/13);
  if(i>=0&&i<PAUSE_ITEMS.length){ ... }
  else { setState('play'); sfxMenu(); }   // <-- hardcoded, ignores pauseRet
  tap=null;
}
```

The pause screen is shared by all three modes and records where it came from in `pauseRet`. Every
other exit honours it — the RESUME row (`:2588`), the pause/jump/start key (`:3122`), QUIT
(`:2606`) and RESTART (`:2601`) all branch on `pauseRet`. This one path does not.

Tapping anywhere below the ten pause rows sets `state='play'` unconditionally.

Consequences, in order of severity:

1. **Boot → THE SHOOTING ALLY → pause → tap low on the screen** puts the game in campaign `play`
   with `P === null`, because no campaign has ever run. `updatePlayer` throws on `P.og`
   (`:3961`) and `render` throws on `P.inv` (`:6960`) — **every frame, forever**. The game is dead;
   only a reload recovers it. This is the exact shape of archaeology #1, in a new place.
2. **Even when `P` exists** (you played the campaign earlier this session), the same tap teleports you
   out of an Op or an arena run into the campaign world. Run lost.
3. **Compounding on touch:** `galResetLvl` hides the d-pad and buttons via `galPadUI(true)`
   (`:1518`), and only `pauseAct('quit')` restores them. After this leak the pads stay hidden, so on
   a phone — the primary target — you land in the campaign **with no controls at all**, in every
   case, `P` or no `P`.

An off-menu tap on a 256×224 canvas scaled to fill a phone screen is not an unlikely input; it is
the most likely way to dismiss a menu.

**Proposed fix.** One line, matching the sibling handlers:

```js
} else { setState(pauseRet); if(pauseRet!=='gal')galPadUI(false); sfxMenu(); }
```

I'd pair it with a guard at the top of `updatePlayer`/`render` so that *no* future path can enter
`play` without a player — that is the defence archaeology #1 earned and this bug slipped past.

---

## P1 — High

### P1-1 · LEFT on the d-pad activates menu rows in three screens (archaeology #6, other direction)

**`index.html:3020`, `:3125`, `:3144`** · verified · `tests/suites/03-menu-input.js`

The fix for "pressing right called `act()`" guarded RIGHT and left LEFT alone. The asymmetry is
visible in the code — these two lines sit next to each other:

```js
if(edge('l')) menuAct(menuSel,-1);                              // :3020  falls through to act()
if(edge('r')){ const m2=MENU[menuSel]; if(m2.adj)m2.adj(1); }    // :3021  guarded, with the comment
                                                                 //        "d-pad adjusts, never enters"
```

`menuAct` is `if(m.adj)m.adj(dir); else if(m.act)m.act();` — and **no `MENU` row defines `adj`**, so
LEFT calls `act()` on all nine rows. Measured:

| Screen | Line | LEFT does |
|---|---|---|
| Main menu | `:3020` | Fires `act()` on all 9 rows; 7 change state (START GAME, LEVEL SELECT, THE SHOOTING ALLY, SUPPLY DEPOT, OPTIONS, MERCH, CREDITS) |
| Level Select | `:3144` | **Launches the selected sector** (RIGHT is correctly guarded on `:3145`) |
| Pause | `:3125` | Fires **RESUME**, **RESTART SECTOR** and **QUIT TO MENU** |

Sub-lists (`:3045`) are already correct — `if(edge('l')){ if(it.adj)it.adj(-1); }`, no fallthrough.
That is the pattern the other three should copy.

Worst case is RESTART SECTOR / QUIT from the pause menu: a stray left-press throws away the run.

**Proposed fix.** Make the three sites structurally identical to the sub-list handler — only ever
call `adj`, never fall through to `act`.

### P1-2 · The build stamp says 0.37 while the build is 0.39 — the anti-stale-cache mechanism is lying

**`index.html:1358`** — `const VER='0.37-ALPHA';`

The handoff says the current build is v0.39-ALPHA, and this file carries the v0.39 feature set:
`MECHROSTER` with history-driven `pickMech` rotation, `CPL. PUNISHMENT` and `DEAD-EYE DOTTIE`,
2P `galMode`, the corrected sniper `rad`, 25 achievements including the 9 Shooting Ally ones. But the
splash screen — the one thing you look at to confirm you are not testing a cached build — reads
**0.37-ALPHA**.

Archaeology #8 exists because three hotfixes shipped under one filename and multiple rounds of
playtest feedback came back against stale code. The rule that came out of it was "every build gets a
new version number **and** a new filename, and `VER` is stamped on the splash." Right now `VER` is
two builds behind, so it would report a stale build as fresh — the failure mode the rule was written
to prevent.

Two things compound it:
- The artifact is called **`index.html`**, not `mecha_hitler_v0_39.html`. On a web host that is the
  single most cache-collided filename there is, which is precisely the v0.15–v0.38 hazard.
- The debug report (`copyDebug`, `:2614`) stamps `VER` into every bug report Nick collects, so
  incoming reports will be misattributed to 0.37.

**Proposed fix.** Bump `VER` to match reality, and decide the hosting story — either version the
filename and let `index.html` redirect, or add a cache-busting query/meta. Worth resolving before the
next playtest round rather than after, since it silently poisons that round's feedback.

---

## P2 — Medium

### P2-1 · Importing a save silently drops a purchased GEN. GUTPUNCH

**`index.html:3110`** · verified · `tests/suites/04-save.js`

```js
if(SAVE.own.gutpunch&&CHARS.length<5)applyShop('gutpunch');
```

`syncChars()` folds the two unlockables into `CHARS`, so a player who has beaten Horde and cleared
The Shooting Ally has `CHARS.length === 6`. The `< 5` test is then false and the import skips
GUTPUNCH — a character they **paid 100 gold for**. Restoring a save on a new device is exactly when
this fires, and it fails silently.

The length test is also unnecessary: `applyShop` already guards with
`if(id==='gutpunch' && !CHARS.includes(GUTPUNCH))` (`:1091`).

**Proposed fix.** Drop the length test: `if(SAVE.own.gutpunch)applyShop('gutpunch');` — identical to
the boot path at `:2688`, which is already correct.

### P2-2 · Four player-facing strings speak in the villain's accent

verified · `tests/suites/06-voice.js`

German-accented dialogue is villain-only. These are the game narrating to the player:

| Line | String | Why it is narration |
|---|---|---|
| `:1688` | `BACK TO ZE TRUSTY PISTOL` | HUD banner about **the player's own** weapon reverting |
| `:1802` | `CHECKPOINT n · BACK IN ZE FIGHT` | Checkpoint banner |
| `:1900` | `STAGE 2: ZE SKELETAL FRAME` | Stage-progress banner |
| `:1900` | `FINAL STAGE: ZE BRAIN ITSELF` | Stage-progress banner |
| `:2709` | achievement `ZE SHOOTING ALLY` | Achievements screen |

The tell is internal: every sibling `galBan()` is plain English — `THAT WAS LARRY'S COUSIN!`,
`HOSTAGE SAVED! +5 AU`, `DIVE INCOMING - TAKE COVER!`, `MINI-MECH: SCRAPPED`. Most directly,
`:1871` says **"THE FRAME COLLAPSES!"** and `:1900`, twenty-nine lines later, says **"ZE SKELETAL
FRAME"** — the same object, both in the narrator's voice, spelled two different ways.

The achievement is also a naming inconsistency: `GALNAME` is `'THE SHOOTING ALLY'` (`:1423`), so the
Achievements screen currently disagrees with the main menu about what the mode is called.

Boss dialogue, boss/machine names (`MK.III DAS UBER-BOOT`), and the moon-base graffiti
`WO IST ZE JAR?` (`:5088`) are all correctly villain-voiced — no change needed.

**Proposed fix.** `ZE` → `THE` in those five places. Mechanical, and the test pins it.

### P2-3 · `galResetLvl` does not clear pending hitstop

**`index.html:1517`** · verified · `tests/suites/02-mode-isolation.js`

`startHorde()` and `startLevel()` both reset `stopT`; `galResetLvl()` does not. `stopT` is only
decremented inside the three gameplay loops, so a kill in another mode (`stopT=2`) survives
indefinitely through the menus and freezes the first frames of an Op. Cosmetic (~33 ms), but it is
the cross-mode state leak class, and `stopT` is already called out in the handoff as a footgun.

**Proposed fix.** Add `stopT=0;` to the `galResetLvl` reset block, which already resets 30-odd
other fields.

### P2-4 · The `post` screen counts time twice as fast

**`index.html:2956` + `:3182`** · verified · `tests/suites/03-menu-input.js`

`updateFrontend` increments `stateT` at the top for every state, then the `post` branch increments it
again. The `stateT>40` input gate therefore opens after 20 frames, not 40.

**Proposed fix.** Delete the second `stateT++` on `:3182`.

---

## P3 — Low / latent

1. **The negative-`rad` trap is still armed.** `galAimAt` (`:1578`) computes
   `const pad = R>0?R : (R<0?R:2);` — the middle branch deliberately preserves a *negative* padding,
   which is what shrank the sniper's target to 3×8px in archaeology #3. No weapon uses a negative
   `rad` today, so this is dormant, but it means the bug can return by editing a data table. Suggest
   `const pad = R>0 ? R : 2;` so the data table cannot re-introduce it.
2. **Pickup handling is duplicated and has already drifted.** `collectPickup` (`:3930`) and
   `hCollect` (`:2219`) are byte-identical for `shield`/`invinc`/`dmg`/`gren`/`heart`/`wpn` and differ
   only in `gold` handling plus two campaign-only kinds. They have already diverged in a user-visible
   way: `SPARE ARMOR STASHED (X TO USE)` vs `SPARE ARMOR STASHED (X)`. See §Redundancy.
3. **`fixSave` hardcodes table sizes.** `best` is fixed at 12 and `gal.best`/`gal.sec` at 4
   (`:2669`, `:2676-2677`), rather than deriving from `LEVELS.length` / `GLV.length`. Adding a 5th Op
   — which the roadmap's scenery pass implies — silently breaks its score and secret tracking. This
   contradicts the house rule that adding content means appending to a table.
4. **`galPtrs._p1` is never cleared** and is compared with `==` against a string key (`:6253`). It
   works by loose coercion, but P1's identity is pinned to the first pointer id seen for the whole Op
   and can be inherited by a later finger. Cosmetic (gun colour) in 2P.
5. **`galMode` and `gal2P` track the same fact.** `gal2P` is set from `galMode` in `galResetLvl`
   (`:1525`); the draw code reads `galMode`. One of them is redundant.
6. **Handoff drift:** the armory has **16** weapons, not 15 (`LIBERTY BOUNCER` is the extra).

---

## Performance

Measured on the harness (canvas calls counted, not rasterised — so this isolates JS cost and draw-call
volume, not GPU fill).

| Scene | update | render | canvas calls/frame | alloc |
|---|---|---|---|---|
| Campaign L0 | 0.018 ms | 0.552 ms | 2,110 | 0.78 KB |
| Campaign L8 (moon) | 0.014 ms | 0.131 ms | 524 | 0.56 KB |
| Horde, wave 15 | 0.016 ms | 0.802 ms | 2,092 | 1.02 KB |
| Shooting Ally, Op 1 | 0.006 ms | 0.756 ms | 3,010 | 0.74 KB |
| Main menu | — | — | 3,232 | — |

**The update loops are not the problem** — they are 4–18 µs. Render is 30–100× more expensive, and
**97% of it is `fillRect`**.

**The single biggest win is `txt()`** (`:4864`). It draws the 3×5 bitmap font one `fillRect` per lit
pixel — up to 15 draw calls per character, at any size. Attribution:

| Scene | `fillRect` from `txt()` | from scenery painters | from sprites |
|---|---|---|---|
| Main menu | **1,541** | ~1,440 | 0 |
| Horde | **859** | ~580 | 8 |
| Ally Op 1 | **781** | ~1,440 | 3 |
| Campaign L0 | **403** | ~1,450 | 1 |

Sprites are already correct — `makeSpr` pre-renders to an offscreen canvas and `drawSpr` does a
single `drawImage`. **The same trick has simply never been applied to text.**

**Proposed fix (no new dependencies, still one file):** pre-render the font to an offscreen glyph
atlas at load, keyed by scale, and have `txt()` do one `drawImage` per character — a ~15× reduction.
Colour can be handled with a small per-colour atlas cache (the palette is a fixed, short list). The
codebase already establishes this exact pattern in `makeSpr` and `buildCRT`, so it is idiomatic here
rather than novel.

Second win: the static parts of the background painters (~1,450 calls/frame) could be baked once per
level into an offscreen canvas, the way `buildCRT` already bakes the scanline overlay.

Allocation is 0.2–1.0 KB/frame (12–60 KB/s) — the per-frame `.filter()` rebuilds of
`bullets`/`enemies`/`parts`. That is modest; I would leave it alone unless profiling on a real device
shows GC hitches. It is a much smaller fish than the draw calls.

---

## Redundancy — what could safely share one implementation

**I have not touched the three update loops**, per your constraint. Everything below is outside them.

**Worth doing — genuinely duplicated, low risk:**

1. **Pickup application** (`collectPickup` `:3930` / `hCollect` `:2219`). Six of eight kinds are
   identical. A shared `applyPickup(pk)` for the common kinds, with the mode-specific `gold`/`life`/
   `babe` handling left in each caller, removes ~25 duplicated lines and stops the drift that has
   already happened. This is the "collision/pickup/damage handling" you flagged, and it is the safest
   of the three.
2. **Menu screen scaffolding.** `lvlsel`, `shop` and the `subList` screens each re-implement the same
   up/down/wrap/tap-row/clamp logic with small differences — which is exactly how the LEFT/RIGHT
   asymmetry in P1-1 survived in three places but not the fourth. One `navigateList(rows, sel)` helper
   would make that class of bug impossible rather than merely fixed.

**Propose, but only with your agreement:**

3. Bullet integration and the AABB/damage step are structurally similar between campaign and horde but
   differ in gravity, terrain and camera. Shareable in principle; I would want a playtest budget
   before touching it, and I am not recommending it now.

---

## Long functions — decomposition assessment

Two of these are much easier than they look, because they are already dispatch tables that simply
never got extracted.

| Function | Lines | Assessment |
|---|---|---|
| `render` `:6783` | 411 | **Easy, near-zero risk.** The first ~45 lines are already a clean `if(state===X){ drawX(); return; }` table. The remaining ~365 are the campaign renderer inlined at the bottom. Extract that tail as `drawPlay()` and `render` becomes the dispatch table it is 90% of the way to being. Pure code motion. |
| `updateFrontend` `:2955` | 272 | **Easy.** Same shape: a chain of `if(state===...)` blocks that each `return`. One function per screen. Doing this alongside P1-1 is natural, since the fix touches three of those blocks anyway. |
| `drawGal` `:6101` / `drawHorde` `:5872` | 155 / 170 | **Moderate, draw-only.** Split by layer (backdrop / actors / FX / HUD). No gameplay risk. |
| `hordeUpdate` `:2257` | 313 | **Needs your sign-off.** Already sectioned by `// ---- move ----` style banners; extraction could follow those seams exactly. But it is a tuned loop and you asked me not to touch these without agreement. |
| `updatePlayer` `:3958` / `updateEnemies` `:4118` | 169 / 159 | **Recommend leaving alone.** Dense, heavily tuned, and the ordering of the timer/aim/fire steps is load-bearing. The size is honest here. |

My suggestion: take `render` and `updateFrontend` now (mechanical, and they make the P0/P1 fixes
easier to review), leave the gameplay loops until you want to spend playtest budget on them.

---

## Open questions for you

1. **`NEWTON'S NEIN`** (`:3246`) — the flagged one. A German pun on a *player* weapon. Every other
   player weapon is Americana (`FREEDOM PEA-SHOOTER`, `LIBER-LASER`, `DEMOCRACY DISPENSER`). It is the
   odd one out, but it is also a good joke. Your call; I have not touched it.
2. **`SIEG NEIN!`** (`:2754`) — a player kill-quip. Same category: the joke *is* the subversion, so
   the accent arguably belongs to the thing being mocked rather than the speaker. I left it and
   excluded it from the voice test with a comment.
3. **`ZE FINAL CURTAIN`** (`:1485`) — Op 4's title. Listed as an official Op name in the handoff, so I
   treated it as an authored choice, not a violation. Flagging it only because it is narration by the
   same logic that condemns `ZE SHOOTING ALLY`. If Op titles count as the villain's framing, it stays;
   if they are narration, it changes.
4. **Hosting vs. version discipline** — see P1-2. What is the intended relationship between
   `index.html` and the `mecha_hitler_v0_XX.html` naming rule?

---

## The harness (`tests/`)

Ported from the sandbox harness and extended, with the lessons from the handoff baked in:

- **Unknown element IDs return `null`.** The element registry is parsed from the real `<head>`/`<body>`
  of `index.html`, so a wrong-ID lookup throws instead of being masked (archaeology #2).
- **Real event registry.** `addEventListener` is a live registry; tests drive the game through
  `HOST.dispatch('pointerdown', …)`, exercising the actual handlers rather than poking internals.
- **Deterministic pumps.** `HOST.frames(n)` runs real `requestAnimationFrame` ticks; `HOST.music(sec)`
  advances a fake `AudioContext` clock and pumps the 25 ms scheduler.
- Fresh `localStorage` and a fresh module instance per test, so save tests cannot contaminate each
  other.

```
node tests/run.js              # everything
node tests/run.js voice save   # substring filter
```

Coverage added beyond the original suites: campaign progression across all 9 sectors, save migration
from 8 historical schemas, audio-scheduler edge cases across all 26 states, cross-mode isolation, and
a fuzz sweep (~48,000 frames per mode) that drives multitouch through the real pointer handlers.

**Not yet covered**, and worth adding next: MK-II weapon upgrade/downgrade rules, the mech rotation
invariant (`pickMech` should never repeat until all six are beaten), and hostage-rescue hit priority.

---

---

## What was done

Landed on `claude/c-v0-40-alpha-baseline` in three reviewable commits.

**1 · Correctness.** All of P0, P1, P2 and P3 above.
- Pause now has a single exit, `pauseResume()`, so no path can forget which mode the player came
  from; `update()` and `render()` refuse to run the campaign without a player.
- LEFT and RIGHT are symmetric in all four menu screens — both only ever adjust.
- `VER` → `0.40-ALPHA`.
- One thing worth flagging: the "derive save slots from the content tables" fix **reproduced
  archaeology #7** on the first attempt. `SAVE` is built ~600 lines before `LEVELS` is declared, so
  reading `LEVELS.length` there is a temporal-dead-zone crash at file load. The harness caught it
  immediately. It now reads through a `try/catch` with the historical sizes as the floor, and the
  reason is commented at the site.

**2 · Performance.** Two static things were being repainted pixel-by-pixel every frame:

| Scene | canvas calls/frame | render time |
|---|---|---|
| Campaign L0 | 2,110 → **480** | 0.552 → **0.328 ms** |
| Shooting Ally Op 1 | 3,010 → **699** | 0.756 → **0.431 ms** |
| Horde wave 15 | 2,092 → **979** | 0.802 → **0.675 ms** |
| Main menu | 3,232 → **585** | — |

`txt()` now blits from a baked glyph atlas (one `drawImage` per character instead of up to 15
`fillRect`s), and `drawSky()`'s dither banding — 1,280 single-pixel fills per frame, none of which
ever changed — is baked once. Both follow the existing `makeSpr`/`buildCRT` pattern, so it is still
one self-contained file with no new assets.

Equivalence was proved rather than assumed: the tests replay the original per-pixel algorithms and
diff the exact set of painted device pixels against what the baked paths produce, for every glyph at
every scale and for the whole sky.

**3 · Structure.** `render` 412 → **53 lines** (now purely the state dispatch table it had been
growing into), with the campaign scene extracted as `drawPlay()`. `updateFrontend` 272 → **20 lines**,
with one function per screen. Both verified as pure code motion by diffing the statement multiset
against the previous commit.

That split immediately earned its keep: `feSubList()` is the one handler whose return value steers
the dispatcher, and its inherited bare `return;` read as "not handled". Harmless today only because
no later screen matches those states — it would have broken the moment someone added one. Fixed, and
pinned by a test.

`hordeUpdate`, `updatePlayer` and `updateEnemies` were left alone, as recommended.

**Verification:** 51 tests green, plus 270,000 fuzzed frames across three seeds and targeted
multitouch sweeps through all four Ops in 1P and 2P, all four sectors, and every horde wave — zero
runtime errors.

## Where I'd go next

- `drawPlay()` is now the largest function at 362 lines. It splits cleanly by layer
  (backdrop / actors / FX / HUD) and that would be worth doing as part of the graphics overhaul
  rather than before it.
- The remaining per-frame draw cost is concentrated in `drawBGCity` (~399 calls/frame). Its parallax
  layers are periodic, so the same baking trick applies — bake one period per layer and blit with a
  wrap offset — but it is worth doing *after* the scenery pass, not before.
- Coverage gaps called out in `tests/README.md`: MK-II upgrade rules, the `pickMech` rotation
  invariant, and hostage hit priority.
