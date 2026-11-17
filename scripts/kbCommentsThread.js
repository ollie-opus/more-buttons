/**
 * kbCommentsThread.js — what is inside an opened comment card: its replies, a
 * reply box, and Edit / Delete on the signed-in user's own comment and replies.
 *
 * One thread is attached to each card (attachThread). The replies load once,
 * the first time the card is opened. Every write goes through the same client
 * object the list uses, and a failed one keeps what was typed and says why
 * under it. Nothing from GitHub is ever markup: all of it is set as text.
 *
 * The page path stored in a comment is refreshed only along with a write that
 * is happening anyway (an edit, or a reply), never on its own.
 *
 * repliesLabel, isOwn and editedBody are pure and Node-tested.
 */

import { withText, withPage, BODY_MAX } from './kbComments.js';
import { lucideSvg } from './lucideIcons.js';
import { setThemeTip } from './kbSite.js';

const SAVE_FAILED = "Couldn't save that.";
const CANT_EDIT = "This comment can't be edited here.";

/** "1 reply" / "N replies"; empty for none. */
export const repliesLabel = n => (n > 0 ? (n === 1 ? '1 reply' : `${n} replies`) : '');

/** Is `author` the signed-in user? (GitHub logins are not case sensitive.) */
export const isOwn = (login, author) => !!login && !!author && String(login).toLowerCase() === String(author).toLowerCase();

/**
 * The body of a comment after its text is edited, with the stored page path
 * and the guide link brought up to date in the same body (one write).
 * Null when the body has no text part to replace (it must not be sent).
 */
export function editedBody(body, text, { livePath, liveUrl, guideTitle }) {
  const edited = withText(body, text);
  if (withText(body, '\u0000') === body) return null; // no text part to replace
  return withPage(edited, livePath, liveUrl, guideTitle);
}

/**
 * @param {HTMLElement} card - the comment's li: needs .mb-kb-comment__meta, __text and __replies
 * @param {object} c - the comment (kbComments.js parseIssue); updated in place when it is edited
 * @param {{doc: Document, client: object, relativeDate: (iso: string) => string, login: () => string|null, dead: () => boolean,
 *   page: {livePath: string, liveUrl: string}, guideTitle: () => string, liveLink: () => string,
 *   onRemoved: (number: number) => void, onChanged: (c: object) => void}} ctx
 * @returns {{open(): void, sync(): void}}
 */
export function attachThread(card, c, ctx) {
  const { doc, client } = ctx;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const iconBtn = (icon, tip, onClick) => {
    const b = el('button', 'mb-kb-comments__icon');
    b.type = 'button';
    b.innerHTML = lucideSvg(icon); // the extension's own bundled markup
    setThemeTip(doc, b, tip);
    b.addEventListener('click', e => { e.stopPropagation(); onClick(b); });
    return b;
  };
  const btn = (label, cls) => {
    const b = el('button', 'mb-kb-comments__btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    return b;
  };
  const errorLine = () => {
    const p = el('p', 'mb-kb-comments__error');
    p.setAttribute('role', 'alert');
    p.hidden = true;
    return p;
  };
  const say = (p, err, fallback) => { p.textContent = err?.message || fallback; p.hidden = false; };

  /**
   * Edit and Delete for one item (the comment, or a reply), and the editor that
   * swaps for its text. `textEl` is the text element; `save(text)` returns when
   * written (throws on failure); `remove()` likewise.
   */
  function itemControls({ textEl, getText, save, remove, afterRemove }) {
    const bar = el('span', 'mb-kb-comments__tools');
    const err = errorLine();
    let editor = null;
    const stop = () => { editor?.remove(); editor = null; textEl.hidden = false; bar.hidden = false; };
    const startEdit = () => {
      if (editor) return;
      err.hidden = true;
      editor = el('div', 'mb-kb-comment__edit');
      const box = el('textarea', 'mb-kb-comments__input');
      box.value = getText();
      box.rows = 2;
      box.maxLength = BODY_MAX;
      box.setAttribute('aria-label', 'Edit');
      const eErr = errorLine();
      const actions = el('div', 'mb-kb-comments__actions');
      const cancel = btn('Cancel');
      const done = btn('Save', '--accent');
      const spin = el('span', 'mb-kb-comments__spin');
      spin.innerHTML = lucideSvg('loader-circle');
      done.prepend(spin);
      actions.append(cancel, done);
      editor.append(box, eErr, actions);
      textEl.hidden = true;
      bar.hidden = true;
      textEl.after(editor);
      let busy = false;
      const sync = () => { done.disabled = busy || !box.value.trim(); };
      const submit = async () => {
        const text = box.value.trim();
        if (!text || busy) return;
        if (text === getText()) return stop();
        busy = true; eErr.hidden = true;
        done.classList.add('--busy'); done.setAttribute('aria-busy', 'true');
        cancel.disabled = true; box.readOnly = true; sync();
        try {
          await save(text);
          if (ctx.dead()) return;
          stop();
        } catch (e) {
          if (ctx.dead()) return;
          say(eErr, e, SAVE_FAILED);
          busy = false;
          done.classList.remove('--busy'); done.removeAttribute('aria-busy');
          cancel.disabled = false; box.readOnly = false; sync(); box.focus();
        }
      };
      box.addEventListener('input', sync);
      box.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) stop(); }
      });
      cancel.addEventListener('click', () => { if (!busy) stop(); });
      done.addEventListener('click', submit);
      sync();
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    };
    const del = iconBtn('trash-2', 'Delete', async b => {
      if (b.disabled) return;
      err.hidden = true;
      bar.querySelectorAll('button').forEach(x => { x.disabled = true; });
      try {
        await remove();
        if (ctx.dead()) return;
        afterRemove();
      } catch (e) {
        if (ctx.dead()) return;
        say(err, e, "Couldn't delete that.");
        bar.querySelectorAll('button').forEach(x => { x.disabled = false; });
      }
    });
    bar.append(iconBtn('pencil', 'Edit', startEdit), del);
    return { bar, err };
  }

  // ── The comment's own Edit / Delete ──
  const meta = card.querySelector(':scope > .mb-kb-comment__meta');
  const textEl = card.querySelector(':scope > .mb-kb-comment__text');
  const box = card.querySelector(':scope > .mb-kb-comment__replies');
  const count = el('p', 'mb-kb-comment__count');
  textEl.after(count);

  if (isOwn(ctx.login(), c.author)) {
    const { bar, err } = itemControls({
      textEl,
      getText: () => c.text,
      save: async text => {
        const body = editedBody(c.body, text, { livePath: ctx.page.livePath, liveUrl: ctx.liveLink(), guideTitle: ctx.guideTitle() });
        if (body == null) throw new Error(CANT_EDIT);
        const made = await client.updateCommentBody(c.number, body);
        if (!made) throw new Error(SAVE_FAILED);
        Object.assign(c, { text: made.text, body: made.body, anchor: made.anchor });
        textEl.textContent = c.text;
        ctx.onChanged(c);
      },
      remove: () => client.closeComment(c.number, 'not_planned'),
      afterRemove: () => ctx.onRemoved(c.number),
    });
    meta.append(bar);
    textEl.after(err);
  }

  // ── Replies ──
  const list = el('ol', 'mb-kb-comment__thread');
  const loadError = errorLine();
  box.append(list, loadError);
  let replies = [];
  let state = 'idle'; // idle | loading | ready

  // Before the replies are loaded the issue's own count is all there is; a reply posted since is in it too (and in `replies`).
  const showCount = () => { count.textContent = repliesLabel(Math.max(replies.length, c.replyCount)); count.hidden = !count.textContent; };

  function replyItem(r) {
    const li = el('li', 'mb-kb-reply');
    const rmeta = el('div', 'mb-kb-comment__meta');
    rmeta.append(el('span', 'mb-kb-comment__author', r.author));
    const time = el('time', 'mb-kb-comment__date', ctx.relativeDate(r.createdAt));
    if (r.createdAt) time.dateTime = r.createdAt;
    rmeta.append(time);
    const text = el('p', 'mb-kb-comment__text', r.text);
    li.append(rmeta, text);
    if (isOwn(ctx.login(), r.author)) {
      const { bar, err } = itemControls({
        textEl: text,
        getText: () => r.text,
        save: async t => {
          const made = await client.editReply(r.id, t);
          if (!made) throw new Error(SAVE_FAILED);
          r.text = made.text ?? t;
          text.textContent = r.text;
        },
        remove: () => client.deleteReply(r.id),
        afterRemove: () => {
          replies = replies.filter(x => x !== r);
          c.replyCount = Math.max(0, c.replyCount - 1);
          li.remove();
          showCount();
        },
      });
      rmeta.append(bar);
      text.after(err);
    }
    return li;
  }

  const form = el('div', 'mb-kb-reply-form');
  const input = el('textarea', 'mb-kb-comments__input mb-kb-reply-form__input');
  input.rows = 1;
  input.maxLength = BODY_MAX;
  input.placeholder = 'Reply…';
  input.setAttribute('aria-label', 'Reply');
  const formErr = errorLine();
  const actions = el('div', 'mb-kb-comments__actions');
  const send = btn('Reply', '--accent');
  const spin = el('span', 'mb-kb-comments__spin');
  spin.innerHTML = lucideSvg('loader-circle');
  send.prepend(spin);
  send.disabled = true;
  actions.append(send);
  form.append(input, formErr, actions);
  box.append(form);

  let posting = false;
  const syncSend = () => {
    send.disabled = posting || !input.value.trim();
    form.classList.toggle('--filled', !!input.value);
  };
  async function post() {
    const text = input.value.trim();
    if (!text || posting) return;
    posting = true; formErr.hidden = true;
    send.classList.add('--busy'); send.setAttribute('aria-busy', 'true');
    input.readOnly = true; syncSend();
    try {
      const made = await client.addReply(c.number, text);
      if (!made) throw new Error(SAVE_FAILED);
      if (ctx.dead()) return;
      replies.push(made);
      c.replyCount += 1;
      list.append(replyItem(made));
      input.value = '';
      showCount();
      refreshPage();
    } catch (e) {
      if (ctx.dead()) return;
      say(formErr, e, SAVE_FAILED);
    } finally {
      posting = false;
      send.classList.remove('--busy'); send.removeAttribute('aria-busy');
      input.readOnly = false; syncSend();
    }
  }
  /** After a reply: bring a stale stored page path up to date (never sent alone, never awaited). */
  function refreshPage() {
    if (c.anchor.page === ctx.page.livePath) return;
    const body = withPage(c.body, ctx.page.livePath, ctx.liveLink(), ctx.guideTitle());
    if (body === c.body) return;
    client.updateCommentBody(c.number, body).then(made => {
      if (made) Object.assign(c, { body: made.body, anchor: made.anchor });
    }, () => {});
  }
  input.addEventListener('input', syncSend);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); }
  });
  send.addEventListener('click', post);

  async function open() {
    if (state !== 'idle') return;
    state = 'loading';
    loadError.hidden = true;
    try {
      const got = c.replyCount > 0 ? await client.listReplies(c.number) : [];
      if (ctx.dead()) return;
      // A reply posted while these were loading (or after an earlier try failed) is not in `got`
      // unless GitHub had it already: keep it, once, after the others.
      const have = new Set(got.map(r => r.id));
      replies = [...got, ...replies.filter(r => !have.has(r.id))];
      c.replyCount = replies.length;
      list.replaceChildren(...replies.map(replyItem));
      state = 'ready';
      showCount();
    } catch (e) {
      if (ctx.dead()) return;
      say(loadError, e, "Couldn't load the replies.");
      state = 'idle'; // tried again the next time the card is opened
    }
  }

  showCount();
  return { open, sync: showCount };
}
