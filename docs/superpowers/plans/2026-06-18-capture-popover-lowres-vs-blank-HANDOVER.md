# HANDOVER — Capture: low-res vs intermittent-blank popover (the core tension)

**Date:** 2026-06-18 · **Updated:** 2026-06-19
**Status:** ✅ **RESOLVED (BUILD-22, user-confirmed full-res + no-blank), then cleaned up.**

> **Resolution (2026-06-19):** Fixed by closing the raster race rather than changing the de-promotion body:
> (1) `background.js` now waits `themeDelay` **AFTER** the `getRectForCapture` rect-read (i.e. after de-promotion), so the async full-res re-raster has the full ~500ms to commit before `Page.captureScreenshot` (was ~2 rAF). (2) `captureElement.js` keeps de-promotion ON and **drops the `transition:none`** the border fix had added (the only effective de-promotion change for this exact-identity popover; identity→none is a zero-delta flip).
> Then **all `[CAPDBG]` scaffolding was removed** and helpers renamed to permanent names (`motionSignature` / `waitForStable` / `animAffectsTransform` / `neutralizeLayers`); retry wrapper, drift-check, SW probe, PNG-parse and `clearMetrics` deleted. `node --check` clean, `tests/captureGeometry.test.mjs` 21/21.
> **Known-accepted leftover:** faint page-behind **bleed-through** in the preview cards. A/B (de-promotion OFF) **ruled out de-promotion** — bleed persists on a fully-opaque light-mode DOM, so it's our capture dropping the opaque popover bg, mechanism not yet root-caused. **User chose to accept it.** Details in memory `project_capture_popover_lowres_fix`.

The investigation log below is retained for history; everything under "Leading directions" is now superseded by the resolution above.

---

## TL;DR / mission

Capturing a small status **pill** that lives inside a popover (`#remote-popover-0`) produces one of two failures, and we can currently only pick which one:

| de-promotion | result |
|---|---|
| **ON** (transform:none on the popover before the shot) | full-res **but intermittent BLANK** (popover missing from the frame → bare white page bg in light mode) |
| **OFF** (BUILD-21, current state) | popover always present **but LOW-RES** |

**They are the same coin.** The popover is GPU-promoted to its own compositor layer that Chrome rasters at LOW resolution. De-promoting it (`transform:none`) forces a full-res inline re-raster — but that raster is **async** and **races** `Page.captureScreenshot`, so intermittently the popover isn't in the captured frame.

**Goal for the next session:** make the full-res de-promotion **reliable** (no raster race) — OR find another way to capture the promoted popover at full resolution without the blank.

---

## The exact symptom (user-reported, confirmed)

- Capturing via **Capture Library → +Create new capture**, Shift-clicking a status pill inside a popover.
- Each capture takes a **light** shot then a **dark** shot (`captureMode.js` ~L410/L422: two awaits, light first).
- **With de-promotion ON:** the **light** preview is intermittently **blank white**; dark looks fine. Intermittent for *any* pill (green/blue/red) — earlier "only green" was small-sample noise. User's machine is in **light mode** naturally, so light is forced first.
- **With de-promotion OFF (BUILD-21):** no blank, but the light capture is **low-res**.
- With my (failed) retry build (BUILD-20) the popover **flickered ~2×/theme** (the retry re-de-promoting) and **both** themes blanked.

---

## Confirmed root cause

The popover element being captured (on a **third-party "remote" page**, NOT in this repo):

```
div#remote-popover-0.<random>.popover.--light-dark.--w-80
  { transform: matrix(1, 0, 0, 1, 0, 0)  (exact identity),  position: absolute }
```

- The identity `transform` (likely the resting state of an enter/theme animation) **GPU-promotes** the popover to its own compositor layer.
- That layer is rastered at **low resolution** and the low-res texture **persists** after the animation settles → soft/low-res capture (the *original* bug the "capture border fix" was chasing).
- `capdbgNeutralizeLayers()` de-promotes it (`transform:none` + `will-change:auto` + `transition:none`, all `!important`) right before the shot so it repaints inline at full res.
- **That repaint/re-raster is asynchronous (off the main thread).** `Page.captureScreenshot` is issued by the service worker (`background.js`) over CDP and intermittently fires **before** the re-raster commits → the popover is **absent** from the frame → we capture the bare main-surface background.
  - **Light mode:** bg is white → obvious `meanRGB=255,255,255 lumStddev=0` blank.
  - **Dark mode:** bg is dark → a dropped frame is far less noticeable, which is why **dark always "looked perfect."**

### Decisive evidence
- **Blank frame:** `RAW stats: opaque=1 meanRGB=255,255,255 lumStddev=0` (pure white, ASCII thumbnail all `@`). Popover content simply absent.
- **Good frame:** `RAW stats: opaque=1 meanRGB=223,232,251 lumStddev=49` (blue pill + text visible in ASCII).
- **Logs are byte-identical between pass and fail** — `VISIBILITY-CHAIN (all opaque/visible)`, `POST-CAPTURE DRIFT none`, rect identical (`924.3046875, 419, 45.3125×24`), `de-promoted … computed transform now none; opacity 1`, `committed+cancelled 0 transform-anim(s)`. The *logged* state is always correct; only the GPU raster *timing* differs. **That is the fingerprint of a compositing race, not a logic error.**
- **`committed+cancelled 0`** for these pills ⇒ there are **no transform animations** on this popover. So the BUILD-15/16 cancel/`commitStyles` machinery is **irrelevant** to this bug. The only thing that matters is the **layer teardown** (`transform:none`/`will-change:auto`) and its async re-raster.
- Toggling de-promotion **OFF** (BUILD-21) → blank gone, low-res returns. This is the clean A/B that **confirms de-promotion is both the low-res fix and the blank cause.**

---

## Investigation history — what was tried (DO NOT REPEAT)

The previous session (me) made several wrong turns. Learn from them:

1. **BUILD-16 — `commitStyles()` before `cancel()`** in `capdbgNeutralizeLayers`. Theory: cancelling a `fill:forwards` scale+fade enter animation reverts the popover to `opacity:0` → blank. **Verified in a synthetic CDP harness** (`/tmp/cap-repro/blank.mjs`, `blank2.mjs`) — but it **did NOT fix the real bug**, because the real popover has **no transform animation** to cancel (`committed+cancelled 0`). ⚠️ **The synthetic harness reproduced a DIFFERENT blank and misled the whole session.** Do not trust synthetic harnesses for this race — it only reproduces in the **real extension on the real remote page**.
2. **BUILD-17/18/19 — diagnostics** (still in the code, useful): `capdbgVisibilityChain`, `capdbgImageStats` (opaque ratio + meanRGB + lumStddev + ASCII thumbnail), `capdbgPaintProfile`. These are what produced the decisive evidence above.
3. **BUILD-20 — detect-blank + retry** (`lumStddev < 2` ⇒ re-shoot, up to 3×, + 32ms/110ms settle after de-promote). **Made it WORSE:** visible flicker (re-de-promote churn) and **both** themes blanked. Retrying the same racy operation didn't help and the churn destabilised the popover. Retry is currently **disabled** (`MAX_ATTEMPTS = 1`).
4. **BUILD-21 — de-promotion gated OFF** (`const CAPDBG_DEPROMOTE = false`). Confirms causation; current state = no blank, low-res.

### Dead ends already ruled out (from the older memory + this session — do NOT re-try)
- Geometry / clip / crop math (`captureGeometry.js`) — pixel-perfect; **do not touch it**.
- DPR / `clipScale` / `setDeviceMetricsOverride` pinning DSF — no-op or no help.
- `captureBeyondViewport: true` — consistently low-res (offscreen surface defaults to DSF=1).
- A discarded warm-up capture — made low-res WORSE.
- `transformIsNearIdentity` near-identity snapping (BUILD-13, in `captureGeometry.js`) — harmless, keep.
- The blank is **not** transparency (alpha is opaque), **not** offset/drift (rect identical, drift none), **not** wiring (`lightDataUrl: light.dataUrl` correct in `captureMode.js handleCapture`), **not** the preview tiles (cards are contrast-inverted; a real light capture shows fine on the dark card).

---

## Current code state (what a fresh session inherits)

All changes are **uncommitted** on top of commit `d2f4790` ("capture border fix"). `git diff` touches `scripts/captureElement.js` and `background.js` (and an **unrelated** pre-existing edit in `scripts/guides.js` — not part of this investigation, leave it).

**`scripts/captureElement.js`:**
- `const CAPDBG_DEPROMOTE = false;` — **L28**. The master toggle. Flip to `true` to re-enable de-promotion.
- `capdbgNeutralizeLayers(el)` — **L85**. The de-promotion (transform/will-change/transition pins + commitStyles/cancel + cssText restore). Only called when `CAPDBG_DEPROMOTE`.
- `screenshotElement(...)` — **L611**, the retry wrapper. `MAX_ATTEMPTS = 1` (**L612**, retry off).
- `screenshotElementOnce(...)` — **L637**, the single-shot. De-promotion gate at **L669**. Blank detection (`lumStddev < 2`) + `_rawStats` return near the end.
- Diagnostics: `capdbgVisibilityChain`, `capdbgImageStats` (ASCII thumbnail), `capdbgPaintProfile` — keep for now; they make the next iteration observable.

**`background.js` (service worker, owns CDP):**
- `captureTab` handler — **L42**. Sequence: attach debugger → `Emulation.setEmulatedMedia(prefers-color-scheme)` (**L59**) → wait `themeDelay` (500ms, **L62**) → `getRectForCapture` to content (**L69**) → `Page.captureScreenshot` (**L98**) → reset emulation → detach.
- **Key ordering fact:** the theme is forced and the 500ms delay elapses, THEN the content script is asked for the rect — and the content script does `waitForStable` + **de-promote** + 2×rAF inside that rect handler, right before the screenshot. So **de-promotion currently happens at the last possible moment**, maximising the race window.

To verify any build: reload at `chrome://extensions`, capture a pill, watch console for `CAPDBG-BUILD-NN` and `RAW stats … lumStddev=…` (blank ⇒ `lumStddev` ≈ 0; healthy ⇒ well above 0).

---

## Leading directions for the fresh session (ranked)

**Hypothesis A (highest value, smallest change): the `transition:none` addition is what made a previously-working de-promotion race.**
The user says capture "**was working before** the border fix" (commit `d2f4790`). Pre-`d2f4790` (`git show 53a1bc3:scripts/captureElement.js`) `capdbgNeutralizeLayers` was **surgical**: only `transform:none` + `will-change:auto`, with **per-property** restore — **no `transition:none`, no cancel, no commitStyles, no cssText restore.** The border fix added `transition:none !important` (and its restore), which can force an extra style recalc / re-raster (or trigger a transition on restore). **Try reverting `capdbgNeutralizeLayers` to the exact `53a1bc3` surgical form, re-enable de-promotion (`CAPDBG_DEPROMOTE = true`), and test for full-res + no-blank.** This is the most likely quick win — it restores the state the user reports worked.

**Hypothesis B: de-promote EARLIER so the re-raster has the full `themeDelay` (500ms) to land before capture.**
Restructure the timing so de-promotion happens **before** the 500ms `themeDelay`, not after. e.g. SW order: `setEmulatedMedia` → request rect (content de-promotes here) → wait `themeDelay` (re-raster + theme settle) → `captureScreenshot`. Caveat: the theme switch itself triggers a re-raster, so emulate-then-depromote-then-wait is the right order. This directly closes the race window with no retry/flicker.

**Hypothesis C: force the re-raster to commit deterministically before the shot.**
rAF + wall-clock settle (BUILD-20) was insufficient. Investigate a stronger commit signal: double-rAF **+ `requestIdleCallback`**, or a forced layout/paint read, or have the **SW** force a frame before `Page.captureScreenshot` (it controls CDP). Lower confidence than A/B.

**Hypothesis D: capture full-res WITHOUT removing the layer.**
The low-res is a persisted low-res *texture* of the promoted layer. Is there a way to invalidate/refresh that texture at full res while keeping the layer (so no teardown race)? e.g. nudging a non-positional property. Speculative; explore only if A–C fail.

**Non-goal:** the BUILD-20 retry. It churns and flickers; don't revive it as the primary fix.

---

## Open question for the user (ask before committing to a direction)
- Is the **low-res** stopgap (current BUILD-21) acceptable while iterating, or should we prioritise restoring full-res immediately (Hypothesis A)?
- How bad is the low-res in practice? (If marginal, "de-promotion off" might be an acceptable ship and this becomes low priority.)

---

## Cleanup owed (independent of the fix)
The tree is full of `[CAPDBG]` scaffolding (build stamps, ASCII/stats logs, paint-profile, visibility-chain, drift log, SW pre-capture probe + PNG-header parse). Once the fix lands and is user-confirmed, strip the debug logging and lift the real helpers into clean permanent names. (This was already owed from the prior low-res work — see memory `project_capture_popover_lowres_fix`.)

## Pointers
- Memory: `project_capture_popover_lowres_fix` (history of the low-res/right-crop saga; note its BUILD-16 "commitStyles fix" claim is **superseded** — that was not the real cause).
- Repro harnesses: `/tmp/cap-repro/` (`blank.mjs`, `blank2.mjs`, `promote.mjs`) — **synthetic, and they MISLED the last session.** The real race only reproduces in the live extension on the remote page. Use them only for compositing intuition, not as proof.
- Geometry tests: `node tests/captureGeometry.test.mjs` (21 pass; `captureGeometry.js` is correct — don't touch).
