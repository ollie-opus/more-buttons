// DOM-free HTML builders for the edit log thread (panel, bubbles, rules,
// redlines). Pure functions; markup is pinned by tests/editLogView.test.mjs.
import { escapeHtml } from './cardRenderer.js';
import { relativeTime } from './actionCards.js';

export const EDIT_LOG_COPY = {
  header: 'Edit log',
  close: 'Close edit log',
  me: 'Me',
  loadError: "Couldn't load edit history.",
  detailError: "Couldn't load this change.",
  empty: 'No edit history recorded yet.',
  expand: 'Show more',
  collapse: 'Show less',
  history: 'Show history',
  more: 'Show more',
};

export function itemHtml(item, { now = Date.now() } = {}) {
  if (item.type === 'day') return `<div class="mb-editlog__day">${escapeHtml(item.label)}</div>`;
  if (item.type === 'rule') {
    const by = item.by ? ` (by ${item.by})` : '';
    return `<div class="mb-editlog__rule" data-editlog-rule="${escapeHtml(item.rule)}">${escapeHtml(item.label + by)}</div>`;
  }
  const side = item.mine ? '--mine' : '--theirs';
  const sha = escapeHtml(item.sha);
  return `<div class="mb-editlog__row ${side}">`
    + `<div class="mb-editlog__bubble${item.muted ? ' --muted' : ''}" data-editlog-sha="${sha}" data-editlog-path="${escapeHtml(item.path)}" data-editlog-parent="${escapeHtml(item.parentSha || '')}">`
    + `<div class="mb-editlog__name">${escapeHtml(nametag(item))}</div>`
    + `<div class="mb-editlog__text">${escapeHtml(item.text)}</div>`
    + '<div class="mb-editlog__meta">'
    + `<button type="button" class="mb-editlog__more" data-editlog-expand="${sha}" aria-expanded="false">${EDIT_LOG_COPY.expand}</button>`
    + `<span class="mb-editlog__time" title="${escapeHtml(new Date(item.date).toLocaleString())}">${escapeHtml(relativeTime(item.date, now))}</span>`
    + '</div>'
    + '<div class="mb-editlog__detail" hidden></div>'
    + '</div></div>';
}

/** "Me (login)" for own bubbles (plain "Me" when no login is known), else the author. */
export function nametag(item) {
  if (!item.mine) return item.nametag;
  return item.nametag ? `${EDIT_LOG_COPY.me} (${item.nametag})` : EDIT_LOG_COPY.me;
}

export function editLogPanelHtml(view, { now = Date.now() } = {}) {
  let inner = '';
  if (view.error) inner += `<p class="more-buttons-description mb-editlog__error">${escapeHtml(EDIT_LOG_COPY.loadError)}</p>`;
  if (view.empty) inner += `<p class="more-buttons-description mb-editlog__empty">${escapeHtml(EDIT_LOG_COPY.empty)}</p>`;
  inner += view.items.map(it => itemHtml(it, { now })).join('');
  if (view.showHistory) inner += `<button type="button" class="mb-editlog__action" data-editlog-history>${EDIT_LOG_COPY.history}</button>`;
  if (view.showMore) inner += `<button type="button" class="mb-editlog__action" data-editlog-more>${EDIT_LOG_COPY.more}</button>`;
  return `<div class="mb-editlog-panel" data-edit-log><div class="mb-editlog">${inner}</div></div>`;
}

/** Navbar tool: toggles the drawer. Lives in the navbar's tools slot, left of Close. */
export function editLogToggleHtml() {
  return `<button type="button" class="more-buttons-nav-arrow mb-editlog__toggle" data-editlog-toggle aria-label="${EDIT_LOG_COPY.header}" title="${EDIT_LOG_COPY.header}" aria-expanded="false" aria-controls="mb-editlog-drawer">`
    + '<span class="more-buttons-icon">history</span></button>';
}

/**
 * The drawer layer: a click-to-close scrim over the form tile and a slim
 * right-hand sidebar holding the header and the thread (rendered into
 * [data-editlog-body] by editLogPanelHtml). Hidden until toggled.
 */
export function editLogDrawerHtml() {
  return '<div class="mb-editlog-layer" data-editlog-layer hidden>'
    + '<div class="mb-editlog-scrim" data-editlog-close></div>'
    + `<aside class="mb-editlog-drawer" id="mb-editlog-drawer" data-editlog-drawer role="region" aria-label="${EDIT_LOG_COPY.header}" tabindex="-1">`
    + `<div class="mb-editlog__head"><span class="more-buttons-icon">history</span><span class="mb-editlog__title">${EDIT_LOG_COPY.header}</span>`
    + `<button type="button" class="more-buttons-nav-arrow mb-editlog__close" data-editlog-close aria-label="${EDIT_LOG_COPY.close}"><span class="more-buttons-icon">x</span></button></div>`
    + '<div class="mb-editlog-drawer__body" data-editlog-body></div>'
    + '</aside></div>';
}

const opHtml = ({ op, text }) => op === 'ins' ? `<ins>${escapeHtml(text)}</ins>`
  : op === 'del' ? `<del>${escapeHtml(text)}</del>` : escapeHtml(text);

export function redlineHtml(blocks) {
  if (!blocks || !blocks.length) return '<p class="more-buttons-description">No text changes.</p>';
  return '<div class="mb-editlog__diff">' + blocks.map(b =>
    `<div class="mb-editlog__diff-section --${escapeHtml(b.status)}">`
    + `<div class="mb-editlog__diff-title">${escapeHtml(b.title)}</div>`
    + `<pre class="mb-editlog__diff-body">${b.ops.map(opHtml).join('')}</pre></div>`).join('') + '</div>';
}

export function bubbleDetailHtml({ changed = '', body = '', blocks = null, error = '' } = {}) {
  let html = '';
  if (changed) html += `<div class="mb-editlog__changed">Changed: ${escapeHtml(changed)}</div>`;
  if (error) {
    html += `<p class="mb-editlog__error">${escapeHtml(error)}</p>`;
    if (body) html += `<pre class="mb-editlog__body">${escapeHtml(body)}</pre>`;
  }
  if (blocks) html += redlineHtml(blocks);
  return html;
}
