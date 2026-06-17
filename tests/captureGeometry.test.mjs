import assert from 'node:assert/strict';
import { computeCaptureClip, cropBoxPx, resolveCornerRadii, transformIsNearIdentity } from '../scripts/captureGeometry.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// Shared fixture: a 100x40 element at (10,20), captured at scale 6 on a Retina
// display (deviceScaleFactor 2, zoom 100% so page devicePixelRatio = 2).
const RETINA = { rect: { x: 10, y: 20, width: 100, height: 40 }, zoom: 1, devicePixelRatio: 2, scale: 6 };

test('computeCaptureClip: integer clipScale and 4-device-px margin around the element', () => {
  const { clip, clipScale, cropDip } = computeCaptureClip(RETINA);
  assert.equal(clipScale, 3); // round(6 / 2)
  // margin = 4 device px = 2 DIP on a 2x display
  assert.equal(clip.x, 8);
  assert.equal(clip.y, 18);
  assert.equal(clip.width, 104);
  assert.equal(clip.height, 44);
  // element box relative to the clip origin, in DIP, with the clip dims attached
  assert.deepEqual(cropDip, { x: 2, y: 2, w: 100, h: 40, clipW: 104, clipH: 44 });
});

test('cropBoxPx: crops correctly when CDP renders at clipScale x deviceScaleFactor (Retina bug)', () => {
  // THE REGRESSION: on a 2x display Chrome's surface capture returns
  // clip.scale * deviceScaleFactor px per DIP (probed empirically: clip 100 DIP
  // at scale 3 -> 600 px bitmap). The old cropPx assumed 3 px/DIP and sliced
  // out the top-left quarter of the element. The crop must be measured from
  // the actual bitmap instead.
  const { cropDip } = computeCaptureClip(RETINA);
  const imgW = 104 * 6, imgH = 44 * 6; // 6 px per DIP, NOT clipScale (3)
  const box = cropBoxPx(cropDip, imgW, imgH);
  assert.deepEqual(box, { x: 12, y: 12, w: 600, h: 240 });
});

test('cropBoxPx: same capture on a 1x-rendered bitmap still crops to the element', () => {
  // If the surface had been rendered at clip.scale alone (1x display semantics),
  // the same cropDip must still land on the element — self-calibrating.
  const { cropDip } = computeCaptureClip(RETINA);
  const box = cropBoxPx(cropDip, 104 * 3, 44 * 3);
  assert.deepEqual(box, { x: 6, y: 6, w: 300, h: 120 });
});

test('computeCaptureClip: snaps fractional element edges to the device-pixel grid', () => {
  const { clip, cropDip } = computeCaptureClip({
    rect: { x: 10.3, y: 20.6, width: 100.3, height: 40.1 },
    zoom: 1, devicePixelRatio: 2, scale: 6,
  });
  // device grid is halves of a DIP on a 2x display
  assert.equal(cropDip.x + clip.x, 10.5);  // eL
  assert.equal(cropDip.y + clip.y, 20.5);  // eT
  assert.equal(cropDip.w, 100);            // 110.5 - 10.5
  assert.equal(cropDip.h, 40);             // 60.5 - 20.5
});

test('computeCaptureClip: browser zoom multiplies the rect into DIP and keeps clipScale integer', () => {
  const { clip, clipScale } = computeCaptureClip({
    rect: { x: 10, y: 20, width: 100, height: 40 },
    zoom: 1.1, devicePixelRatio: 2.2, scale: 6,
  });
  assert.equal(clipScale, 3); // round(6 / 2.2)
  // physicalDpr = 2.2 / 1.1 = 2 -> margin still 2 DIP; edges snapped on the 2x grid
  assert.equal(clip.x, 11 - 2);
  assert.equal(clip.y, 22 - 2);
  assert.equal(clip.width, 110 + 4);
  assert.equal(clip.height, 44 + 4);
});

test('computeCaptureClip: tight mode has no margin and a zero-offset crop', () => {
  const { clip, cropDip } = computeCaptureClip({ ...RETINA, tight: true });
  assert.equal(clip.x, 10);
  assert.equal(clip.y, 20);
  assert.equal(clip.width, 100);
  assert.equal(clip.height, 40);
  assert.deepEqual(cropDip, { x: 0, y: 0, w: 100, h: 40, clipW: 100, clipH: 40 });
});

test('computeCaptureClip: clip is snapped outward to whole DIPs (fractional element edges)', () => {
  // CDP rounds fractional clip rects inward (probed: a 113.9999975-DIP-wide
  // clip at zoom 1.1 came back a full DIP short and shifted) — so the clip
  // sent to CDP must sit on integer DIP boundaries, with the margin absorbing
  // the extra. Element at 10.3 CSS snaps to 10.5 DIP (device px 21); the clip
  // floors/ceils outward to integers and cropDip carries the fractional offset.
  const { clip, cropDip } = computeCaptureClip({
    rect: { x: 10.3, y: 20.6, width: 100.3, height: 40.1 },
    zoom: 1, devicePixelRatio: 2, scale: 6,
  });
  assert.equal(clip.x, 8);        // floor(10.5 - 2)
  assert.equal(clip.y, 18);       // floor(20.5 - 2)
  assert.equal(clip.width, 105);  // ceil(110.5 + 2) - 8
  assert.equal(clip.height, 45);  // ceil(60.5 + 2) - 18
  assert.deepEqual(cropDip, { x: 2.5, y: 2.5, w: 100, h: 40, clipW: 105, clipH: 45 });
});

test('computeCaptureClip: float-dust devicePixelRatio still yields an integer-DIP clip', () => {
  // zoom 1.1 reports dpr 2.200000047683716 (float32), so dpr/zoom is not
  // exactly 2 — the snapped edges carry ~1e-8 dust. The clip must still be
  // exactly integer so CDP's inward rounding is a no-op.
  const { clip } = computeCaptureClip({
    rect: { x: 100, y: 40, width: 100, height: 40 },
    zoom: 1.1, devicePixelRatio: 2.200000047683716, scale: 6,
  });
  assert.ok(Number.isInteger(clip.x), `clip.x ${clip.x}`);
  assert.ok(Number.isInteger(clip.y), `clip.y ${clip.y}`);
  assert.ok(Number.isInteger(clip.width), `clip.width ${clip.width}`);
  assert.ok(Number.isInteger(clip.height), `clip.height ${clip.height}`);
});

test('computeCaptureClip: tight mode also snaps outward, with cropDip marking the exact box', () => {
  // Resize-mode rects are fractional under zoom too and hit the same CDP
  // inward rounding; tight now means "no extra margin", not "no crop".
  const { clip, cropDip } = computeCaptureClip({
    rect: { x: 10.3, y: 20.6, width: 100.3, height: 40.1 },
    zoom: 1, devicePixelRatio: 2, scale: 6, tight: true,
  });
  assert.equal(clip.x, 10);       // floor(10.5)
  assert.equal(clip.y, 20);       // floor(20.5)
  assert.equal(clip.width, 101);  // ceil(110.5) - 10
  assert.equal(clip.height, 41);  // ceil(60.5) - 20
  assert.deepEqual(cropDip, { x: 0.5, y: 0.5, w: 100, h: 40, clipW: 101, clipH: 41 });
});

test('cropBoxPx: clamps to the bitmap bounds', () => {
  const box = cropBoxPx({ x: 2, y: 2, w: 200, h: 200, clipW: 104, clipH: 44 }, 104, 44);
  assert.equal(box.x, 2);
  assert.equal(box.y, 2);
  assert.equal(box.w, 102);
  assert.equal(box.h, 42);
});

test('cropBoxPx: falls back to the full bitmap when no crop box is supplied', () => {
  const box = cropBoxPx(null, 640, 480);
  assert.deepEqual(box, { x: 0, y: 0, w: 640, h: 480 });
});

// ── resolveCornerRadii: the rounded-corner mask shape ─────────────────────────
// Box helper: 2x bitmap of the CSS box (Retina scale-1 capture), so sx=sy=2.
const box = (elW, elH) => ({ elW, elH, w: elW * 2, h: elH * 2, sx: 2, sy: 2 });
const same = (s) => ({ tl: s, tr: s, br: s, bl: s });

test('resolveCornerRadii: symmetric px radius is unchanged (circular corners, common case)', () => {
  const r = resolveCornerRadii(same('8px'), box(100, 40));
  for (const c of ['tl', 'tr', 'br', 'bl']) assert.deepEqual(r[c], { x: 16, y: 16 });
});

test('resolveCornerRadii: percentage resolves per-axis — vertical uses HEIGHT, not width (symptom A)', () => {
  // 120x28 button, border-radius:25%. CSS paints rx=25% of width, ry=25% of
  // height. The old mask used 25% of width for BOTH axes and drew a circle,
  // over-rounding the short axis and clipping content.
  const r = resolveCornerRadii(same('25%'), box(120, 28));
  // rx = 0.25*120*2 = 60 ; ry = 0.25*28*2 = 14 ; clamp f = 1 (no overlap)
  for (const c of ['tl', 'tr', 'br', 'bl']) assert.deepEqual(r[c], { x: 60, y: 14 });
});

test('resolveCornerRadii: explicit elliptical "H V" keeps the vertical token (not dropped)', () => {
  const r = resolveCornerRadii({ tl: '40px 8px', tr: '0px', br: '0px', bl: '0px' }, box(200, 100));
  assert.deepEqual(r.tl, { x: 80, y: 16 }); // 40*2 by 8*2 — old code dropped the 8px
  assert.deepEqual(r.tr, { x: 0, y: 0 });
});

test('resolveCornerRadii: oversized pill radius clamps to the half-height semicircle', () => {
  const r = resolveCornerRadii(same('9999px'), box(120, 32));
  // f collapses every radius to h/2 = 32 bitmap px → correct pill ends
  for (const c of ['tl', 'tr', 'br', 'bl']) assert.deepEqual(r[c], { x: 32, y: 32 });
});

test('resolveCornerRadii: 50% on a square box is a full circle', () => {
  const r = resolveCornerRadii(same('50%'), box(64, 64));
  for (const c of ['tl', 'tr', 'br', 'bl']) assert.deepEqual(r[c], { x: 64, y: 64 });
});

test('resolveCornerRadii: zero radius everywhere yields a plain rectangle (no NaN/Infinity)', () => {
  const r = resolveCornerRadii(same('0px'), box(100, 40));
  for (const c of ['tl', 'tr', 'br', 'bl']) assert.deepEqual(r[c], { x: 0, y: 0 });
});

// ── transformIsNearIdentity: the de-promotion gate ────────────────────────────

test('transformIsNearIdentity: none / empty / exact identity are identity', () => {
  assert.equal(transformIsNearIdentity('none'), true);
  assert.equal(transformIsNearIdentity(''), true);
  assert.equal(transformIsNearIdentity(undefined), true);
  assert.equal(transformIsNearIdentity('matrix(1, 0, 0, 1, 0, 0)'), true);
});

test('transformIsNearIdentity: settled easing residual counts as identity (THE REGRESSION)', () => {
  // rAF easing lands a hair off 1.0 — the old exact-string gate skipped these,
  // leaving the layer promoted (low-res) and the box drifting (right-edge crop).
  assert.equal(transformIsNearIdentity('matrix(0.9998, 0, 0, 0.9998, 0, 0)'), true);
  // scale about a centered transform-origin leaves a sub-px translation too
  assert.equal(transformIsNearIdentity('matrix(0.9994, 0, 0, 0.9994, 0.3, 0.18)'), true);
  // matrix3d form (libraries force GPU with translateZ)
  assert.equal(transformIsNearIdentity('matrix3d(0.9997, 0, 0, 0, 0, 0.9997, 0, 0, 0, 0, 1, 0, 0.2, 0.1, 0, 1)'), true);
});

test('transformIsNearIdentity: deliberate transforms are NOT identity (must stay promoted)', () => {
  assert.equal(transformIsNearIdentity('matrix(1, 0, 0, 1, 40, 0)'), false);   // translate(40px)
  assert.equal(transformIsNearIdentity('matrix(1.4, 0, 0, 1.4, 0, 0)'), false); // scale(1.4)
  assert.equal(transformIsNearIdentity('matrix(0.92, 0, 0, 0.92, 0, 0)'), false); // mid-animation scale
  assert.equal(transformIsNearIdentity('matrix(0.99, -0.14, 0.14, 0.99, 0, 0)'), false); // rotate(8deg)
  assert.equal(transformIsNearIdentity('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 50, 0, 0, 1)'), false); // translate3d(50px)
});

test('transformIsNearIdentity: unparseable / unexpected forms are treated as real', () => {
  assert.equal(transformIsNearIdentity('rotate(8deg)'), false); // not a matrix form
  assert.equal(transformIsNearIdentity('matrix(1, 0, 0, 1, 0)'), false); // wrong arg count
});

console.log(`\n${passed} passed`);
