/**
 * capturePresets.js — the kinds of capture, as size + corner presets.
 *
 * Nothing new is stored: a preset is a shape of the settings a capture's
 * markdown already carries (dimMode / dimValue / rounded), so every capture
 * ever written reads as one of them.
 *
 *   button   an icon or a button: 50px tall, square corners. The Knowledge
 *            Base's image-borders.css draws no hairline around an image whose
 *            style has `height:`, so a button never gets a box around it.
 *   xs sm md lg   a taller capture held to a set width (200 / 300 / 400 /
 *            500px), rounded.
 *   auto     as wide as it is (the page caps it), rounded.
 *   custom   anything else: its own height or width, rounded unless told not.
 *
 * Pure: no DOM, no chrome.*.
 */

export const WIDTHS = { xs: 200, sm: 300, md: 400, lg: 500 };

export const CAPTURE_PRESETS = [
  ['button', 'Button / Icon'],
  ['xs', 'XS'],
  ['sm', 'SM'],
  ['md', 'MD'],
  ['lg', 'LG'],
  ['auto', 'Auto'],
  ['custom', 'Custom'],
];

const SHAPES = {
  button: { dimMode: 'height', dimValue: 50, rounded: false },
  ...Object.fromEntries(Object.entries(WIDTHS).map(([name, width]) => [name, { dimMode: 'width', dimValue: width, rounded: true }])),
  auto: { dimMode: 'none', dimValue: null, rounded: true },
};

/** The settings a preset stands for ({dimMode, dimValue, rounded}), or null for custom / unknown. */
export function capturePresetShape(preset) {
  return SHAPES[preset] ? { ...SHAPES[preset] } : null;
}

/** Which preset a capture's settings are; 'custom' when they match none. */
export function capturePresetOf(cap) {
  const mode = cap?.dimMode ?? 'none';
  const value = mode === 'none' ? null : Number(cap?.dimValue);
  const rounded = !!cap?.rounded;
  for (const [name, s] of Object.entries(SHAPES)) {
    if (s.dimMode === mode && s.dimValue === value && s.rounded === rounded) return name;
  }
  return 'custom';
}

/**
 * Set a capture (in place) to a preset. Custom keeps the size it has and
 * turns corner rounding on: from there the size and corners are set by hand.
 */
export function applyCapturePreset(cap, preset) {
  const shape = capturePresetShape(preset);
  if (shape) Object.assign(cap, shape);
  else cap.rounded = true;
  return cap;
}

/**
 * A first guess at "is this capture an icon or a button?", from what capture
 * mode recorded about the thing shot (`subject`: { width, height, control,
 * svg } in CSS px). An extracted SVG is an icon. Otherwise it is a matter of
 * size: a button capture is shown 50px tall, so anything much taller than a
 * line of controls is not one, and neither is a short but wide strip (a table
 * row, a toolbar). Being a control buys a little more room. Unknown: no.
 */
export function looksLikeButton(subject) {
  if (!subject) return false;
  if (subject.svg) return true;
  const { width, height } = subject;
  if (!(width > 0 && height > 0)) return false;
  return subject.control ? height <= 80 && width <= 420 : height <= 64 && width <= 300;
}
