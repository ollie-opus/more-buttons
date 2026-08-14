/**
 * buttonPreview.js — live light/dark preview tiles for the Button edit form.
 *
 * Two side-by-side tiles simulate the published page in each scheme (light
 * tile = white page, dark tile = the KB's slate background) and hold a
 * synthesized .md-button painted from the labelColours.json preset — the same
 * hand-synced palette the KB's buttons.css trios use. The colour maths mirrors
 * buttons.css exactly: the theme modifier picks WHICH trio paints per page
 * scheme, and the border modifier follows the painted trio (not the scheme),
 * including the neutral curated light border vs the chromatic
 * color-mix(30% fg) fallback.
 *
 * Both tiles render simultaneously, so colours are applied as explicit per-tile
 * inline styles — deliberately NOT the label pills' --bg/--bg-dark +
 * prefers-color-scheme pattern, which can only show one scheme at a time.
 *
 * buttonTileColours/paintedSide/strongLightBorder are pure (node-testable);
 * renderButtonPreview is the DOM half.
 */

/**
 * Which colour trio paints on a given simulated page scheme. Mirrors the
 * buttons.css scheme pickers + theme modifiers: default follows the scheme,
 * inversed opposes it, force-* ignores it.
 *
 * @param {'default'|'inversed'|'force-light'|'force-dark'} theme
 * @param {'light'|'dark'} tile - the page scheme this tile simulates
 * @returns {'light'|'dark'} - the trio that paints
 */
export function paintedSide(theme, tile) {
  if (theme === 'force-light') return 'light';
  if (theme === 'force-dark') return 'dark';
  if (theme === 'inversed') return tile === 'light' ? 'dark' : 'light';
  return tile;
}

/**
 * The "strong" light border an enabled border mode uses: the neutrals carry a
 * curated light border in the preset; the chromatics' light border is
 * transparent by design, so fall back to buttons.css's --btn-light-strong
 * formula. Chrome resolves color-mix() in inline styles, so the literal string
 * passes through.
 */
export function strongLightBorder(preset) {
  const b = preset?.light?.border;
  if (b && b !== 'transparent') return b;
  return `color-mix(in srgb, ${preset?.light?.text} 30%, transparent)`;
}

/**
 * Inline colours for one preview tile. `hover` is the brightness filter the
 * painted trio would get on the real site (--btn-hover); `hoverStrong` is the
 * harder variant slim uses (--btn-hover-strong — slim suppresses the theme's
 * opacity fade, which half-cancelled the gentle brightness on pale trios).
 *
 * @param {{preset: object, theme?: string, border?: string, tile: 'light'|'dark'}} opts
 * @returns {{background: string, color: string, borderColor: string, hover: string, hoverStrong: string}}
 */
export function buttonTileColours({ preset, theme = 'default', border = 'default', tile }) {
  const side = paintedSide(theme, tile);
  const trio = preset[side];

  let borderColor;
  switch (border) {
    case 'bordered':
      borderColor = side === 'light' ? strongLightBorder(preset) : preset.dark.border;
      break;
    case 'border-light':
      borderColor = side === 'light' ? strongLightBorder(preset) : 'transparent';
      break;
    case 'border-dark':
      borderColor = side === 'dark' ? preset.dark.border : 'transparent';
      break;
    case 'borderless':
      borderColor = 'transparent';
      break;
    default:
      borderColor = trio.border;
  }

  return {
    background: trio.bg,
    color: trio.text,
    borderColor,
    hover: side === 'light' ? 'brightness(0.95)' : 'brightness(1.15)',
    hoverStrong: side === 'light' ? 'brightness(0.9)' : 'brightness(1.3)',
  };
}

// ── DOM half ─────────────────────────────────────────────────────────────────

function buildTile(tile) {
  const fig = document.createElement('figure');
  fig.className = `mb-btn-tile mb-btn-tile--${tile}`;
  const cap = document.createElement('figcaption');
  cap.className = 'mb-btn-tile__title';
  cap.textContent = tile === 'light' ? 'Light mode' : 'Dark mode';
  const a = document.createElement('a');
  a.className = 'mb-btn-preview';
  a.tabIndex = -1;
  a.addEventListener('click', e => e.preventDefault());
  fig.append(cap, a);
  return fig;
}

/**
 * Renders (or re-renders) both preview tiles into `host`. Idempotent: tiles are
 * built once and mutated on later calls. No colour selected yet (create mode)
 * → a ghost placeholder so Label/Icon still preview.
 *
 * @param {HTMLElement} host - the [data-button-preview] div
 * @param {{label, colour, theme, border, style, iconSvg}} fields
 *   iconSvg: pre-sanitized lucide SVG markup ('' for none) — see
 *   iconPicker.getLucideSvgMarkup.
 * @param {object} flat - loadLabelPalette().flat (slug → preset)
 */
export function renderButtonPreview(host, { label, colour, theme, border, style, iconSvg }, flat) {
  if (!host) return;
  if (!host.childElementCount) {
    host.append(buildTile('light'), buildTile('dark'));
  }
  const preset = colour ? flat?.[colour] : null;

  for (const tile of ['light', 'dark']) {
    const a = host.querySelector(`.mb-btn-tile--${tile} .mb-btn-preview`);
    if (!a) continue;

    a.classList.toggle('mb-btn-preview--slim', style === 'slim');
    a.classList.toggle('mb-btn-preview--ghost', !preset);

    a.textContent = label || (iconSvg ? '' : 'Button');
    if (iconSvg) {
      const icon = document.createElement('span');
      icon.className = 'twemoji';
      icon.innerHTML = iconSvg; // sanitized upstream (getLucideSvgMarkup)
      if (label) a.append(' ');
      a.append(icon);
    }

    if (preset) {
      const c = buttonTileColours({ preset, theme, border, tile });
      a.style.background = c.background;
      a.style.color = c.color;
      a.style.borderColor = c.borderColor;
      a.style.setProperty('--mb-btn-hover', style === 'slim' ? c.hoverStrong : c.hover);
    } else {
      a.style.background = '';
      a.style.color = '';
      a.style.borderColor = '';
      a.style.removeProperty('--mb-btn-hover');
    }
  }
  host.hidden = false;
}
