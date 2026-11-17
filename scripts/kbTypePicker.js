/**
 * kbTypePicker.js — an admonition's types as pills, for the "Type" group of
 * its menu in the in-page editor (kbPageEditor.js, Cmd / Ctrl+click).
 *
 * Each pill is a small copy of its admonition (icon, tint, border, title
 * colour), read off the theme as it stands, so a restyled or new type needs
 * nothing here and the light and dark schemes follow by themselves.
 *
 * (Changing the type by clicking the admonition's own icon was removed,
 * 2026-11-16: the menu already does it.)
 *
 * The arrow-key geometry (nextPill, floatMenu.js) is pure and Node-tested; the rest needs a DOM.
 */

import { menuTick, nextPill } from './floatMenu.js';

export { nextPill }; // the arrow-key geometry, shared by every floating menu (floatMenu.js)



const clear = colour => !colour || colour === 'transparent' || /^rgba\(.*,\s*0\)$/.test(colour);

// What the theme gives each type: one unseen admonition of each is drawn and
// read, then taken away again (nothing is painted in between).
function readStyles(types) {
  const holder = document.createElement('div');
  holder.className = 'md-typeset';
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;left:-9999px;top:0;width:400px;visibility:hidden;pointer-events:none';
  for (const [id] of types) {
    const box = document.createElement('div');
    box.className = `admonition ${id}`;
    const title = document.createElement('p');
    title.className = 'admonition-title';
    title.textContent = id;
    box.append(title);
    holder.append(box);
  }
  document.body.append(holder);
  const styles = new Map();
  [...holder.children].forEach((box, i) => {
    const b = getComputedStyle(box);
    const title = box.firstElementChild;
    const icon = getComputedStyle(title, '::before');
    const mask = icon.maskImage || icon.webkitMaskImage || '';
    const drawn = icon.display !== 'none' && mask && mask !== 'none';
    styles.set(types[i][0], {
      tint: clear(b.backgroundColor) ? '' : b.backgroundColor,
      border: parseFloat(b.borderTopWidth) > 0 && !clear(b.borderTopColor) ? b.borderTopColor : '',
      text: getComputedStyle(title).color,
      // A type with no icon still has a colour of its own: its border's.
      colour: drawn && !clear(icon.backgroundColor) ? icon.backgroundColor : (clear(b.borderTopColor) ? '' : b.borderTopColor),
      mask: drawn ? mask : '',
    });
  });
  holder.remove();
  return styles;
}

let styles = null;
let stylesKey = null;

/**
 * The types as pills, each a small copy of its admonition, the one it is now
 * ringed and ticked (`aria-checked`). Each carries its type in `data-type`.
 * @param {Array<[string, string]>} types  [id, label]
 * @param {string|null} current
 * @returns {HTMLButtonElement[]}
 */
export function typePills(types, current) {
  const key = `${document.body.getAttribute('data-md-color-scheme') ?? ''}|${types.map(t => t[0]).join(',')}`;
  if (!styles || key !== stylesKey) { styles = readStyles(types); stylesKey = key; }
  return types.map(([id, label]) => {
    const s = styles.get(id);
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'mb-fm__pill mb-kb-types__pill';
    pill.dataset.type = id;
    pill.setAttribute('role', 'menuitemradio');
    pill.setAttribute('aria-checked', String(id === current));
    if (s.colour) pill.style.setProperty('--c', s.colour);
    if (s.tint) pill.style.setProperty('--tint', s.tint);
    if (s.border) pill.style.setProperty('--bd', s.border);
    if (s.text) pill.style.setProperty('--fg', s.text);
    if (s.mask) {
      const icon = document.createElement('span');
      icon.className = 'mb-kb-types__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.style.maskImage = s.mask;
      icon.style.webkitMaskImage = s.mask;
      pill.append(icon);
    }
    const text = document.createElement('span');
    text.className = 'mb-fm__text';
    text.textContent = label;
    pill.append(text, menuTick());
    return pill;
  });
}

