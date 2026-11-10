/**
 * builderPickables.js — what the Selenium command builder can pick on a page,
 * and how the command it writes will find that thing again.
 *
 * Pick mode hands a hovered element to describePick, which answers with a
 * Pick (one future sheet column) or null when the element is not something
 * the builder handles:
 *
 *   text-like <input>          → text            free text
 *   <textarea>                 → textarea        free text
 *   <select> (single)          → select          one of its options
 *   radios sharing a name      → radioGroup      one of its members
 *   2+ checkboxes on a name    → checkboxGroup   several of its members
 *   any other checkbox         → checkbox        TRUE / FALSE
 *   <button>, submit/button/
 *   image inputs               → button          submit / click
 *
 * A group is every radio or checkbox on the page with that name, whatever
 * form it sits in: that is exactly what emerald's /seleniumPageAutomation
 * resolves for a `name` target at run time, so the choices listed here are
 * the choices the command will see.
 *
 * Pure: the two document lookups are injected (`look`), and only the DOM
 * surface of the fake in tests/builderPickables.test.mjs is used.
 */
import { buildLocator, describeElement } from './actionLocators.js';

// ── The contract with emerald ───────────────────────────────────────────────
// These three functions define what an option's "label", "value" and "id"
// are. The emerald command runs the same code in the page to match an option
// at run time, so the sheet validates against identical strings. They are
// copied from the design spec; never change them on one side only.

export function collapse(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

// radio / checkbox input
export function choiceOf(el) {
  var lbl = el.labels && el.labels.length ? collapse(el.labels[0].textContent) : '';
  var aria = collapse(el.getAttribute('aria-label'));
  var value = String(el.value == null ? '' : el.value);
  return { label: lbl || aria || value, value: value, id: el.id || '' };
}

// <option> of a <select>
export function choiceOfOption(opt) {
  var value = String(opt.value == null ? '' : opt.value);
  return { label: collapse(opt.getAttribute('label')) || collapse(opt.textContent) || value, value: value, id: opt.id || '' };
}

// ── From a hovered element to its control ───────────────────────────────────

const CONTROL_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);
const UNPICKABLE_INPUTS = new Set(['hidden', 'file', 'reset']);
const BUTTON_INPUTS = new Set(['submit', 'button', 'image']);

const typeOf = el => (el.getAttribute('type') || '').toLowerCase();

/**
 * The form control a hovered element stands for: the element itself, the
 * control a child sits in (the <span> inside a <button>), or the control a
 * <label> belongs to. null when there is none.
 */
export function controlFor(el) {
  for (let node = el; node; node = node.parentElement) {
    if (CONTROL_TAGS.has(node.tagName)) return node;
    if (node.tagName === 'LABEL') return node.control || null;
  }
  return null;
}

// ── Addressing ──────────────────────────────────────────────────────────────

// How the command finds one control: its name when nothing else on the page
// shares it (Rails pairs a checkbox with a hidden input of the same name, so
// that one never qualifies), otherwise the first recorder candidate that
// matches exactly one element, otherwise the structural css path.
function addressOf(el, look) {
  const name = el.getAttribute('name');
  if (name && look.byName(name).length === 1) return { targetType: 'name', target: name };
  const candidates = buildLocator(el).candidates.filter(c => c.selector);
  const unique = candidates.find(c => look.count(c.selector) === 1);
  if (unique && unique.type === 'id') return { targetType: 'id', target: el.getAttribute('id') };
  return { targetType: 'css', target: (unique || candidates[candidates.length - 1]).selector };
}

function titleOf(el) {
  return el.getAttribute('name') || el.getAttribute('id') || describeElement(el).label;
}

function buttonTitleOf(el) {
  return collapse(el.textContent) || collapse(el.getAttribute('value')) || collapse(el.getAttribute('aria-label'))
    || collapse(el.getAttribute('title')) || 'button';
}

function pickOf(kind, title, typeLabel, address, elements, { choices = null, submit = false } = {}) {
  return {
    key: `${kind}:${address.targetType}:${address.target}`,
    kind, title, typeLabel,
    targetType: address.targetType, target: address.target,
    choices, submit, elements,
  };
}

function buttonPick(el, submit, look) {
  return pickOf('button', buttonTitleOf(el), submit ? 'submit button' : 'button', addressOf(el, look), [el], { submit });
}

// Every radio or checkbox on the page carrying `name`, in document order.
function groupMembers(name, look) {
  return look.byName(name).filter(m => m.tagName === 'INPUT' && (typeOf(m) === 'radio' || typeOf(m) === 'checkbox'));
}

function groupPick(kind, typeLabel, name, members) {
  return pickOf(kind, name, typeLabel, { targetType: 'name', target: name }, members, { choices: members.map(choiceOf) });
}

/**
 * The Pick for whatever `el` stands for, or null when it is not pickable.
 * `look` = { byName: name => Element[], count: selector => number }.
 */
export function describePick(el, look) {
  const control = controlFor(el);
  if (!control) return null;

  if (control.tagName === 'SELECT') {
    if (control.hasAttribute('multiple')) return null;
    return pickOf('select', titleOf(control), 'dropdown', addressOf(control, look), [control],
      { choices: Array.from(control.options || []).map(choiceOfOption) });
  }

  if (control.tagName === 'TEXTAREA') {
    return pickOf('textarea', titleOf(control), 'textarea', addressOf(control, look), [control]);
  }

  if (control.tagName === 'BUTTON') {
    const type = typeOf(control);
    return buttonPick(control, (type === '' || type === 'submit') && !!control.form, look);
  }

  if (control.tagName !== 'INPUT') return null;
  const type = typeOf(control) || 'text';
  if (UNPICKABLE_INPUTS.has(type)) return null;
  if (BUTTON_INPUTS.has(type)) return buttonPick(control, type !== 'button' && !!control.form, look);

  const name = control.getAttribute('name');
  if (type === 'radio') {
    return name ? groupPick('radioGroup', 'radio group', name, groupMembers(name, look)) : null;
  }
  if (type === 'checkbox') {
    const members = name ? groupMembers(name, look) : [];
    if (members.length > 1) return groupPick('checkboxGroup', 'checkbox group', name, members);
    return pickOf('checkbox', titleOf(control), 'checkbox', addressOf(control, look), [control]);
  }
  return pickOf('text', titleOf(control), type, addressOf(control, look), [control]);
}

// ── Outlining a group ───────────────────────────────────────────────────────

/** The deepest element containing every one of `elements`; of one element, that element. */
export function commonAncestor(elements) {
  let chain = [];
  for (let node = elements[0]; node; node = node.parentElement) chain.push(node);
  for (const el of elements.slice(1)) {
    let node = el;
    while (node && !chain.includes(node)) node = node.parentElement;
    chain = node ? chain.slice(chain.indexOf(node)) : chain.slice(-1);
  }
  return chain[0];
}
