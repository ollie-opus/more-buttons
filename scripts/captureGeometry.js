/**
 * captureGeometry.js — Pure clip/crop math for CDP element screenshots.
 *
 * Shared by the service worker (computes the CDP clip) and the content script
 * (crops the returned bitmap). Pixel-exact capture rests on two grid
 * alignments:
 *
 * 1. INTEGER clip.scale. A fractional value (e.g. 6/2.2 under browser zoom)
 *    makes CDP resample and round, which clamps the captured region ~1 DIP
 *    short and shifts edges. `scale` is only a quality knob, so rounding
 *    scale/devicePixelRatio to the nearest integer is free.
 *
 * 2. DEVICE-pixel-snapped element box. getBoundingClientRect() is fractional,
 *    but the browser paints element edges snapped to the device-pixel grid.
 *    Cropping from the raw fractional rect misses the painted edge by a
 *    sub-pixel that scale magnifies into visible px. Snapping the box to the
 *    device grid registers the crop against the pixels actually drawn.
 *
 * Crucially, the crop box is expressed in DIP relative to the clip origin —
 * NOT in bitmap pixels. How many bitmap px one DIP becomes depends on the
 * display the window is on: Chrome captures the physical surface, so the
 * bitmap is clip.scale * deviceScaleFactor px per DIP (probed empirically:
 * clip 100 DIP at scale 3 → 600 px on a 2x display, 300 px on a 1x one).
 * Assuming either factor bakes in a display dependency — cropBoxPx instead
 * measures the actual px-per-DIP from the decoded bitmap, which is correct
 * everywhere.
 */

/**
 * Compute the CDP screenshot clip for an element box.
 *
 * @param {{ rect: {x:number,y:number,width:number,height:number},
 *           zoom: number, devicePixelRatio: number, scale: number,
 *           tight?: boolean }} input
 *   rect is in logical CSS px (page coordinates); zoom is the tab zoom
 *   (CDP clip coords are CSS px at zoom=1, so the rect is multiplied up);
 *   devicePixelRatio is the page's window.devicePixelRatio (deviceScaleFactor
 *   * zoom); scale is the requested output quality multiplier. Element
 *   captures take a 4-device-px background margin (cropped off afterwards via
 *   cropBoxPx) so any residual rounding can't eat the element's edge;
 *   `tight` captures (resize mode) add no extra margin, but are still snapped
 *   outward to whole DIPs and must be cropped back to cropDip afterwards.
 * @returns {{ clip: {x,y,width,height}, clipScale: number,
 *             cropDip: {x,y,w,h,clipW,clipH} }}
 *   clip + clipScale feed Page.captureScreenshot; cropDip is the element box
 *   relative to the clip origin in DIP, carrying the clip dims so cropBoxPx
 *   can calibrate against the actual bitmap.
 */
export function computeCaptureClip({ rect, zoom, devicePixelRatio, scale, tight = false }) {
  // Element box in DIP, the coordinate space CDP's clip expects.
  const rx = rect.x * zoom;
  const ry = rect.y * zoom;
  const rw = rect.width  * zoom;
  const rh = rect.height * zoom;

  const physicalDpr = devicePixelRatio / zoom;            // device px per DIP
  const clipScale = Math.max(1, Math.round(scale / devicePixelRatio));
  const snapDip = v => Math.round(v * physicalDpr) / physicalDpr; // → nearest device px
  const eL = snapDip(rx);
  const eT = snapDip(ry);
  const eR = snapDip(rx + rw);
  const eB = snapDip(ry + rh);

  const MARGIN = tight ? 0 : 4 / physicalDpr; // 4 device px, in DIP

  // Snap the clip OUTWARD to whole DIPs. CDP rounds fractional clip rects
  // inward (probed at zoom 1.1: a 113.9999975-DIP clip came back a full DIP
  // short and shifted, because devicePixelRatio carries float32 dust like
  // 2.200000047683716 so the device-snapped edges aren't clean fractions).
  // An integer-DIP clip survives CDP untouched at any zoom/DSF, and keeps the
  // bitmap at exactly clipScale * deviceScaleFactor px per DIP with no output
  // rounding. The fractional remainder moves into cropDip, where the
  // bitmap-calibrated crop handles it exactly.
  const clipL = Math.floor(eL - MARGIN);
  const clipT = Math.floor(eT - MARGIN);
  const clipR = Math.ceil(eR + MARGIN);
  const clipB = Math.ceil(eB + MARGIN);
  const clip = {
    x:      clipL,
    y:      clipT,
    width:  clipR - clipL,
    height: clipB - clipT,
  };

  const cropDip = {
    x: eL - clip.x,
    y: eT - clip.y,
    w: eR - eL,
    h: eB - eT,
    clipW: clip.width,
    clipH: clip.height,
  };

  return { clip, clipScale, cropDip };
}

/**
 * Resolve a cropDip box against the decoded bitmap, in bitmap pixels.
 *
 * px-per-DIP is measured from the bitmap itself (imgWidth / clipW), so the
 * crop is exact whether or not CDP multiplied clip.scale by the display's
 * deviceScaleFactor. Clamped to the bitmap bounds defensively; falls back to
 * the full bitmap when no box was supplied.
 *
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function cropBoxPx(cropDip, imgWidth, imgHeight) {
  if (!cropDip) return { x: 0, y: 0, w: imgWidth, h: imgHeight };
  const pxPerDipX = imgWidth  / cropDip.clipW;
  const pxPerDipY = imgHeight / cropDip.clipH;
  const x = Math.min(Math.max(0, cropDip.x * pxPerDipX), imgWidth);
  const y = Math.min(Math.max(0, cropDip.y * pxPerDipY), imgHeight);
  const w = Math.min(Math.max(1, cropDip.w * pxPerDipX), imgWidth  - x);
  const h = Math.min(Math.max(1, cropDip.h * pxPerDipY), imgHeight - y);
  return { x, y, w, h };
}

/**
 * Resolve an element's four CSS corner radii into clamped {x, y} ellipse radii
 * in BITMAP pixels, for the rounded-corner capture mask.
 *
 * CSS paints every corner as an ELLIPSE: the horizontal radius resolves against
 * the box width, the vertical against the height. getComputedStyle keeps each
 * border-*-radius as one token "H" (H==V) or two tokens "H V" (elliptical /
 * slash syntax), and — crucially — keeps percentages UNRESOLVED ("25%", not a
 * px pair). So a percentage corner is `% of width` wide by `% of height` tall.
 * The old mask read only the first token and resolved it against width for both
 * axes, drawing a circle: it over-rounded the short axis of wide/short and
 * percentage-radius elements (clipping real content) and squared-off true
 * ellipses — the two reported capture bugs.
 *
 * Each axis is scaled by its own bitmap-px-per-CSS-px (sx, sy), then the single
 * CSS overlap-clamp factor (CSS Backgrounds-3 §5.5) shrinks every radius if two
 * radii on an edge would overlap. Symmetric px radii (the common case) are
 * returned unchanged (x === y), so circular corners and pills are unaffected.
 *
 * @param {{ tl: string, tr: string, br: string, bl: string }} corners
 *   computed borderTopLeft / TopRight / BottomRight / BottomLeft-Radius strings
 * @param {{ elW: number, elH: number, w: number, h: number, sx: number, sy: number }} box
 *   elW/elH: element box in CSS px; w/h: canvas size (element box in bitmap px);
 *   sx/sy: bitmap px per CSS px on each axis
 * @returns {{ tl: {x,y}, tr: {x,y}, br: {x,y}, bl: {x,y} }} radii in bitmap px
 */
export function resolveCornerRadii(corners, { elW, elH, w, h, sx, sy }) {
  const axis = (tok, dim, scale) => {
    const t = tok.trim();
    return t.endsWith('%')
      ? (parseFloat(t) / 100) * dim * scale
      : (parseFloat(t) || 0) * scale;
  };
  const corner = (val) => {
    const [hTok, vTok = hTok] = val.trim().split(/\s+/);
    return { x: axis(hTok, elW, sx), y: axis(vTok, elH, sy) };
  };

  const tl = corner(corners.tl), tr = corner(corners.tr),
        br = corner(corners.br), bl = corner(corners.bl);

  // One factor f = min over the four edges of edge-length / sum-of-its-two
  // radii, applied to every radius (both axes). A zero-radius edge makes its
  // term Infinity, which Math.min ignores, so f stays 1 for square corners.
  const f = Math.min(1,
    w / (tl.x + tr.x), w / (bl.x + br.x),   // top & bottom edges (horizontal radii)
    h / (tl.y + bl.y), h / (tr.y + br.y));  // left & right edges (vertical radii)
  if (f < 1) for (const c of [tl, tr, br, bl]) { c.x *= f; c.y *= f; }

  return { tl, tr, br, bl };
}
