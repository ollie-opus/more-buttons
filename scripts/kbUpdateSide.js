/**
 * kbUpdateSide.js — the two text buttons that stand either side of an update
 * on the System Updates drafts page, in the in-page editor (kbPageEditor.js):
 *
 *     ← Delete from draft   [ the update ]   Push to live →
 *
 * On the live content (`live`), the two are instead:
 *
 *     ← Clone to draft   [ the update ]   Delete from live →
 *
 * Clone to draft copies the update into the drafts (to be edited and pushed
 * back over the live one); Delete from live takes it off the live page. An update that is in
 * the drafts already (`hasDraft`) reads "← View draft" instead: it goes there.
 *
 * And beside an update that has been published and is waiting for the site to
 * build it (`pending`), there is one only:
 *
 *     ← Cancel publish   [ the greyed update ]
 *
 * It takes the update off the live page and puts it back in the drafts.
 *
 * They slide out of the update into the empty margin while the pointer is on
 * the update or anything inside it (the editor decides that). Delete asks once more in the
 * button before it runs. While either runs, its button shows a spinner and
 * holds its place; when it has succeeded the editor slides the update off the
 * page the way its button points (slideOut).
 *
 * Placed in page px on <body>, like a block's menu. Needs a DOM.
 */

import { getLucideSvgMarkup } from './lucideIcons.js';

const GAP = 14;          // px between the update and a button
const EDGE = 8;          // px a button keeps inside the window
const CONFIRM_MS = 4000; // how long "Confirm delete?" waits for its second click

const LABELS = {
  delete: { idle: 'Delete from draft', live: 'Delete from live', confirm: 'Confirm delete?', busy: 'Deleting…' },
  publish: { idle: 'Push to live', busy: 'Pushing to live…' },
  draft: { idle: 'Clone to draft', view: 'View draft', busy: 'Cloning to draft…' },
  cancel: { idle: 'Cancel publish', busy: 'Cancelling…' },
};

/**
 * @param {object} o
 * @param {(uuid: string) => Element|null} o.nodeOf   the update's element now (the page is redrawn often)
 * @param {() => {top: number, bottom: number}} o.view the window's clear band (under the header, over the bar)
 * @param {(uuid: string) => void} [o.onDelete]
 * @param {(uuid: string) => void} [o.onPublish]
 * @param {(uuid: string) => void} [o.onDraft]
 * @param {(uuid: string) => void} [o.onCancel]
 * @param {boolean} [o.pending] beside an update being published: Cancel publish to the left, nothing to the right
 * @param {boolean} [o.live] the live content's pair: Clone to draft to the left, Delete from live to the right
 * @param {(uuid: string) => boolean} [o.hasDraft] live only: the update is in the drafts already
 */
export function attachUpdateSide({ nodeOf, view, onDelete, onPublish, onDraft, onCancel, hasDraft, live = false, pending = false }) {
  const el = document.createElement('div');
  el.className = 'mb-kb-upd-side';
  // `iconFirst`: the button stands to the update's left, its arrow pointing away.
  const make = (act, iconFirst) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `mb-kb-upd-side__btn --${act} ${iconFirst ? '--left' : '--right'}`;
    const icon = document.createElement('span');
    icon.className = 'mb-kb-upd-side__icon';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'mb-kb-upd-side__label';
    btn.append(...(iconFirst ? [icon, label] : [label, icon]));
    el.append(btn);
    return { btn, icon, label, act, iconFirst };
  };
  // `del` is the button on the left and `pub` the one on the right, whatever each does.
  // `pending` has no button on the right.
  const del = make(pending ? 'cancel' : live ? 'draft' : 'delete', true);
  const pub = pending ? null : make(live ? 'delete' : 'publish', false);
  const parts = pub ? [del, pub] : [del];
  document.body.append(el);

  const icons = { left: '', right: '', spinner: '' };
  const paint = part => {
    const busy = state.busy === part.act;
    part.icon.innerHTML = busy ? icons.spinner : part.iconFirst ? icons.left : icons.right;
    part.btn.classList.toggle('--spin', busy);
    const words = LABELS[part.act];
    const drafted = part.act === 'draft' && !!state.uuid && !!hasDraft?.(state.uuid);
    part.label.textContent = busy ? words.busy : part.act === 'delete' && state.confirming ? words.confirm : drafted ? words.view : live && words.live ? words.live : words.idle;
    part.btn.classList.toggle('--view', drafted); // going to a draft that exists is no action: it is drawn neutral
    part.btn.classList.toggle('--confirm', part.act === 'delete' && state.confirming && !busy);
    part.btn.classList.toggle('--dim', !!state.busy && !busy);
    part.btn.disabled = !!state.busy;
  };
  const paintAll = () => { parts.forEach(paint); place(); };
  Promise.all([getLucideSvgMarkup('arrow-left'), getLucideSvgMarkup('arrow-right'), getLucideSvgMarkup('loader-circle')])
    .then(([left, right, spinner]) => {
      Object.assign(icons, { left: left || '', right: right || '', spinner: spinner || '' });
      paintAll();
    }).catch(() => {});

  const state = { uuid: null, busy: null, confirming: false };
  let confirmTimer = 0;

  const unconfirm = () => {
    clearTimeout(confirmTimer);
    if (!state.confirming) return;
    state.confirming = false;
    paintAll();
  };

  function place() {
    const node = state.uuid ? nodeOf(state.uuid) : null;
    if (!node) { el.classList.remove('--on'); return; }
    const box = node.getBoundingClientRect();
    const title = node.querySelector(':scope > summary, :scope > .admonition-title')?.getBoundingClientRect() ?? box;
    const bh = del.btn.offsetHeight;
    const { top: viewTop } = view();
    // Level with the title; once that has scrolled away, they come down the
    // page with the window, as far as the update goes.
    const level = title.top + (title.height - bh) / 2;
    const y = Math.max(box.top, Math.min(Math.max(level, viewTop + EDGE), box.bottom - bh));
    const vw = document.documentElement.clientWidth;
    const left = Math.max(EDGE, box.left - GAP - del.btn.offsetWidth);
    del.btn.style.left = `${left + window.scrollX}px`;
    del.btn.style.top = `${y + window.scrollY}px`;
    if (!pub) return;
    const right = Math.min(vw - EDGE - pub.btn.offsetWidth, box.right + GAP);
    pub.btn.style.left = `${right + window.scrollX}px`;
    pub.btn.style.top = `${y + window.scrollY}px`;
  }

  // A copy of each button that can still be seen, left where it stands to
  // slide back in and fade from exactly where it has got to. It takes no
  // clicks and is gone when that is over.
  function leaveGhosts() {
    for (const part of parts) {
      const cs = getComputedStyle(part.btn);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
      const ghost = part.btn.cloneNode(true);
      ghost.disabled = true;
      ghost.tabIndex = -1;
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, { transition: 'none', opacity: cs.opacity, transform: cs.transform, visibility: 'visible' });
      el.append(ghost);
      void ghost.offsetWidth;
      ghost.classList.add('--ghost');
      Object.assign(ghost.style, { transition: '', opacity: '', transform: '', visibility: '' });
      setTimeout(() => ghost.remove(), 320);
    }
  }

  const RUN = { delete: onDelete, publish: onPublish, draft: onDraft, cancel: onCancel };
  for (const part of parts) {
    part.btn.addEventListener('click', () => {
      if (state.busy || !state.uuid) return;
      // Delete asks once more, in the button.
      if (part.act === 'delete' && !state.confirming) {
        state.confirming = true;
        paintAll();
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(unconfirm, CONFIRM_MS);
        return;
      }
      const uuid = state.uuid;
      unconfirm();
      RUN[part.act]?.(uuid);
    });
  }
  // A press on a button must not take the caret out of the text being edited
  // before the click decides what happens.
  el.addEventListener('mousedown', e => e.preventDefault());

  paintAll();

  return {
    el,
    /** The update the buttons are out for now, or null. */
    get uuid() { return el.classList.contains('--on') ? state.uuid : null; },
    /** Bring the buttons out beside this update (null puts them away). A running action holds them where they are. */
    show(uuid) {
      if (state.busy) { place(); return; }
      const moving = !!uuid && uuid !== state.uuid && !!nodeOf(uuid);
      // Going to another update: the pair there now (out, or on its way back
      // in) finishes sliding in where it is, as a copy, while the real pair
      // starts tucked in beside the new one.
      if (moving) leaveGhosts();
      if (uuid !== state.uuid) unconfirm();
      if (!uuid || !nodeOf(uuid)) {
        unconfirm();
        el.classList.remove('--on'); // they keep their place while they slide back in
        return;
      }
      if (moving) {
        for (const part of parts) part.btn.style.transition = 'none';
        el.classList.remove('--on');
      }
      state.uuid = uuid;
      if (hasDraft) paintAll(); // what the left button says depends on the update
      else place();
      if (moving) {
        void el.offsetWidth; // the tucked-in start is taken up before the slide out begins
        for (const part of parts) part.btn.style.transition = '';
      }
      el.classList.add('--on');
    },
    /** Keep them beside what they are for (the page scrolled, or changed height). */
    place,
    /** `act` ('delete' | 'publish' | 'draft' | 'cancel') is running for this update: its button waits it out. null: done. */
    busy(act, uuid = state.uuid) {
      state.busy = act;
      if (act) { state.uuid = uuid; el.classList.add('--on'); }
      paintAll();
    },
    /** Put them away at once (their update is leaving the page). */
    release() {
      state.busy = null;
      unconfirm();
      el.classList.remove('--on');
      paintAll();
    },
  };
}

/**
 * An update leaving the page: it slides off the way its button pointed and
 * fades, then the gap it leaves closes. Resolves when that is over (at once
 * for a reader who asked for reduced motion; never later than its length, even
 * where no frames are drawn).
 * @param {Element|null} node @param {'left'|'right'} dir
 */
export function slideOut(node, dir) {
  if (!node?.isConnected) return Promise.resolve();
  const run = (frames, duration, easing) => new Promise(resolve => {
    let anim;
    try { anim = node.animate(frames, { duration, easing, fill: 'forwards' }); } catch { resolve(); return; }
    const timer = setTimeout(resolve, duration + 80);
    anim.finished.then(() => { clearTimeout(timer); resolve(); }, resolve);
  });
  node.style.pointerEvents = 'none';
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return run([{ opacity: 1 }, { opacity: 0 }], 120, 'linear');
  }
  const ease = 'cubic-bezier(.4, 0, .2, 1)';
  const x = dir === 'left' ? -80 : 80;
  const height = node.getBoundingClientRect().height;
  const cs = getComputedStyle(node);
  const margins = { marginTop: cs.marginTop, marginBottom: cs.marginBottom };
  return run([{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${x}px)`, opacity: 0 }], 320, ease)
    .then(() => {
      if (!node.isConnected) return undefined;
      node.style.overflow = 'hidden';
      return run([{ height: `${height}px`, ...margins }, { height: '0px', marginTop: '0px', marginBottom: '0px' }], 220, ease);
    });
}
