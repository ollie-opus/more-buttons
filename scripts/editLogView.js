// DOM-free HTML builders for the edit log thread (panel, bubbles, rules,
// redlines). Pure functions; markup is pinned by tests/editLogView.test.mjs.
import { escapeHtml } from './cardRenderer.js';
import { relativeTime } from './actionCards.js';

export const EDIT_LOG_COPY = {
  header: 'Edit log',
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
    return `<div class="mb-editlog__rule" data-editlog-rule="${escapeHtml(item.rule)}">${escapeHtml(item.label)}</div>`;
  }
  const side = item.mine ? '--mine' : '--theirs';
  const sha = escapeHtml(item.sha);
  return `<div class="mb-editlog__row ${side}">`
    + `<div class="mb-editlog__bubble${item.muted ? ' --muted' : ''}" data-editlog-sha="${sha}" data-editlog-path="${escapeHtml(item.path)}" data-editlog-parent="${escapeHtml(item.parentSha || '')}">`
    + (item.mine ? '' : `<div class="mb-editlog__name">${escapeHtml(item.nametag)}</div>`)
    + `<div class="mb-editlog__text">${escapeHtml(item.text)}</div>`
    + `<div class="mb-editlog__time" title="${escapeHtml(new Date(item.date).toLocaleString())}">${escapeHtml(relativeTime(item.date, now))}</div>`
    + `<button type="button" class="mb-editlog__more" data-editlog-expand="${sha}" aria-expanded="false">${EDIT_LOG_COPY.expand}</button>`
    + '<div class="mb-editlog__detail" hidden></div>'
    + '</div></div>';
}

export function editLogPanelHtml(view, { now = Date.now() } = {}) {
  let inner = '';
  if (view.error) inner += `<p class="more-buttons-description mb-editlog__error">${escapeHtml(EDIT_LOG_COPY.loadError)}</p>`;
  if (view.empty) inner += `<p class="more-buttons-description mb-editlog__empty">${escapeHtml(EDIT_LOG_COPY.empty)}</p>`;
  inner += view.items.map(it => itemHtml(it, { now })).join('');
  if (view.showHistory) inner += `<button type="button" class="mb-editlog__rule --action" data-editlog-history>${EDIT_LOG_COPY.history}</button>`;
  if (view.showMore) inner += `<button type="button" class="mb-editlog__rule --action" data-editlog-more>${EDIT_LOG_COPY.more}</button>`;
  return '<div class="more-buttons-form-group more-buttons-form-group--full" data-edit-log>'
    + `<label class="more-buttons-label"><span class="more-buttons-icon">history</span>${EDIT_LOG_COPY.header}</label>`
    + `<div class="mb-editlog">${inner}</div></div>`;
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
