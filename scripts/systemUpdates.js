import { registerFormAction } from './formActions.js';
import { githubFetchAndPushFile, githubPushImageIfNotExists } from './github.js';
import { createForm } from './form.js';
import { captureElement, setCaptureStoreMode } from './captureElement.js';

// ── Module-level capture state ────────────────────────────────────────────────
let pendingCaptures = [];
let partialCapture = {};

// ── Constants ─────────────────────────────────────────────────────────────────

const UPDATES_FILE = 'docs/pages/system-updates.md';

const TYPE_LABELS = {
  'feature-release': 'Feature release',
  'new-addition':    'New addition',
  'improvement':     'Improvement',
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// ── Private helpers ───────────────────────────────────────────────────────────

function escapeHtml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatUpdateDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const v = day % 100;
  const ordinal = (v >= 11 && v <= 13) ? 'th' : (['th','st','nd','rd'][v % 10] ?? 'th');
  return `${day}${ordinal} ${MONTH_NAMES[month - 1]} ${year}`;
}

function parseDateStr(formattedDate) {
  const m = formattedDate.match(/^(\d+)\w*\s+(\w+)\s+(\d{4})$/);
  if (!m) return null;
  const monthIdx = MONTH_NAMES.indexOf(m[2]);
  if (monthIdx === -1) return null;
  return { year: parseInt(m[3]), month: monthIdx + 1, day: parseInt(m[1]) };
}

function getYearMonthFromDateStr(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  return { year, month, monthLabel: `${MONTH_NAMES[month - 1]} ${year}` };
}

// ── Parse / build ─────────────────────────────────────────────────────────────

export function parseUpdateBlocks(markdown) {
  const lines = markdown.split('\n');
  const updates = [];
  let i = 0;
  let blockIdx = 0;

  while (i < lines.length) {
    const headerMatch = lines[i].match(/^\?\?\? (feature-release|new-addition|improvement) "(.+)"$/);
    if (headerMatch) {
      const type = headerMatch[1];
      const fullTitle = headerMatch[2];
      const dateMatch = fullTitle.match(/<small[^>]*>([^<]+)<\/small>/);
      const date = dateMatch ? dateMatch[1] : '';
      const rawTitle = fullTitle.replace(/<br><small[^>]*>[^<]*<\/small>/, '').trim();
      const labelPrefix = (TYPE_LABELS[type] ?? '') + ': ';
      const title = rawTitle.startsWith(labelPrefix) ? rawTitle.slice(labelPrefix.length) : rawTitle;

      i++;
      const bodyLines = [];
      while (i < lines.length && (lines[i].startsWith('    ') || lines[i] === '')) {
        bodyLines.push(lines[i].startsWith('    ') ? lines[i].slice(4) : lines[i]);
        i++;
      }
      while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();

      updates.push({ type, title, date, body: bodyLines.join('\n'), idx: blockIdx++ });
    } else {
      i++;
    }
  }
  return updates;
}

export function buildUpdateBlock(update, captures = []) {
  const typeLabel = TYPE_LABELS[update.type] ?? update.type;
  const formattedDate = formatUpdateDate(update.date);
  const header = `??? ${update.type} "${typeLabel}: ${update.title}<br><small style="opacity: 0.6">${formattedDate}</small>"`;

  const descLines = (update.description ?? update.body ?? '').split('\n').map(l => l.length ? '    ' + l : l);
  const captureLines = captures.flatMap(c => [
    '',
    `    ![](../assets/${c.lightFilename}#only-light){ width="700" loading=lazy }`,
    `    ![](../assets/${c.darkFilename}#only-dark){ width="700" loading=lazy }`,
  ]);

  return [header, '', ...descLines, ...captureLines].join('\n');
}

// ── Month/Year heading management ─────────────────────────────────────────────

function cleanEmptyYearSection(md, year) {
  const lines = md.split('\n');
  const yearIdx = lines.findIndex(l => l === `## ${year}`);
  if (yearIdx === -1) return md;

  let hasMonths = false;
  let nextYearIdx = lines.length;
  for (let i = yearIdx + 1; i < lines.length; i++) {
    if (/^## \d{4}/.test(lines[i])) { nextYearIdx = i; break; }
    if (/^### /.test(lines[i])) { hasMonths = true; break; }
  }
  if (hasMonths) return md;

  let removeStart = yearIdx;
  if (removeStart > 0 && lines[removeStart - 1] === '') removeStart--;
  return [...lines.slice(0, removeStart), ...lines.slice(nextYearIdx)].join('\n');
}

function cleanEmptyMonthSection(md, monthLabel, year) {
  const lines = md.split('\n');
  const monthIdx = lines.findIndex(l => l === `### ${monthLabel}`);
  if (monthIdx === -1) return md;

  let hasUpdates = false;
  let nextSectionIdx = lines.length;
  for (let i = monthIdx + 1; i < lines.length; i++) {
    if (/^#{2,3} /.test(lines[i])) { nextSectionIdx = i; break; }
    if (/^\?\?\? /.test(lines[i])) { hasUpdates = true; break; }
  }
  if (hasUpdates) return md;

  let removeStart = monthIdx;
  if (removeStart > 0 && lines[removeStart - 1] === '') removeStart--;
  md = [...lines.slice(0, removeStart), ...lines.slice(nextSectionIdx)].join('\n');
  return cleanEmptyYearSection(md, year);
}

export function insertUpdateIntoMarkdown(markdown, update, captures = []) {
  const block = buildUpdateBlock(update, captures);
  const { year, month, monthLabel } = getYearMonthFromDateStr(update.date);
  let md = markdown;

  // Ensure year section exists
  if (!new RegExp(`^## ${year}\\s*$`, 'm').test(md)) {
    const yearBlock = `## ${year}\n\n---\n\n`;
    const yearRe = /^## (\d{4})\s*$/gm;
    let insertPos = -1;
    let ym;
    while ((ym = yearRe.exec(md)) !== null) {
      if (parseInt(ym[1]) < year) { insertPos = ym.index; break; }
    }
    if (insertPos >= 0) {
      const needsBlank = insertPos >= 2 && md[insertPos - 2] !== '\n';
      md = md.slice(0, insertPos) + (needsBlank ? '\n' : '') + yearBlock + md.slice(insertPos);
    } else {
      md = md.trimEnd() + '\n\n' + yearBlock;
    }
  }

  // Ensure month heading exists
  if (!new RegExp(`^### ${monthLabel}\\s*$`, 'm').test(md)) {
    const yearStart = md.search(new RegExp(`^## ${year}\\s*$`, 'm'));
    const afterYearLine = md.indexOf('\n', yearStart) + 1;
    const nextYearMatch = /^## \d{4}/m.exec(md.slice(afterYearLine));
    const yearEnd = nextYearMatch ? afterYearLine + nextYearMatch.index : md.length;
    const yearSection = md.slice(afterYearLine, yearEnd);

    const monthRe = /^### (\w+) (\d{4})\s*$/gm;
    let insertRelIdx = -1;
    let mm;
    while ((mm = monthRe.exec(yearSection)) !== null) {
      if ((MONTH_NAMES.indexOf(mm[1]) + 1) < month) { insertRelIdx = mm.index; break; }
    }

    const monthBlock = `### ${monthLabel}\n\n`;
    if (insertRelIdx >= 0) {
      const absIdx = afterYearLine + insertRelIdx;
      md = md.slice(0, absIdx) + monthBlock + md.slice(absIdx);
    } else {
      const absEnd = nextYearMatch ? md.indexOf(nextYearMatch[0], afterYearLine) : md.length;
      md = md.slice(0, absEnd) + monthBlock + md.slice(absEnd);
    }
  }

  // Insert block at top of month section (after heading + blank lines)
  const monthPos = md.search(new RegExp(`^### ${monthLabel}\\s*$`, 'm'));
  let insertAt = md.indexOf('\n', monthPos) + 1;
  while (insertAt < md.length && md[insertAt] === '\n') insertAt++;
  return md.slice(0, insertAt) + block + '\n\n' + md.slice(insertAt);
}

export function replaceUpdateInMarkdown(markdown, idx, update, newCaptures = []) {
  const lines = markdown.split('\n');
  let count = 0;
  let startLine = -1;
  let endLine = -1;
  let i = 0;

  while (i < lines.length) {
    if (/^\?\?\? (feature-release|new-addition|improvement) ".+"$/.test(lines[i])) {
      if (count === idx) {
        startLine = i;
        i++;
        while (i < lines.length && (lines[i].startsWith('    ') || lines[i] === '')) i++;
        endLine = i;
        break;
      }
      count++;
    }
    i++;
  }

  if (startLine === -1) return markdown;
  const newBlock = buildUpdateBlock(update, newCaptures);
  return [...lines.slice(0, startLine), ...newBlock.split('\n'), ...lines.slice(endLine)].join('\n');
}

export function deleteUpdateFromMarkdown(markdown, idx) {
  const updates = parseUpdateBlocks(markdown);
  const target = updates[idx];
  if (!target) return markdown;

  const lines = markdown.split('\n');
  let count = 0;
  let startLine = -1;
  let endLine = -1;
  let i = 0;

  while (i < lines.length) {
    if (/^\?\?\? (feature-release|new-addition|improvement) ".+"$/.test(lines[i])) {
      if (count === idx) {
        startLine = i;
        i++;
        while (i < lines.length && (lines[i].startsWith('    ') || lines[i] === '')) i++;
        if (i < lines.length && lines[i] === '') i++;
        endLine = i;
        break;
      }
      count++;
    }
    i++;
  }

  if (startLine === -1) return markdown;

  let effectiveStart = startLine;
  if (effectiveStart > 0 && lines[effectiveStart - 1] === '') effectiveStart--;

  let md = [...lines.slice(0, effectiveStart), ...lines.slice(endLine)].join('\n');

  const dateInfo = parseDateStr(target.date);
  if (dateInfo) {
    const monthLabel = `${MONTH_NAMES[dateInfo.month - 1]} ${dateInfo.year}`;
    md = cleanEmptyMonthSection(md, monthLabel, dateInfo.year);
  }

  return md;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function updateCard(update) {
  const colours = {
    'feature-release': { text: '#1d4ed8', border: '#93c5fd', bg: '#dbeafe' },
    'new-addition':    { text: '#15803d', border: '#86efac', bg: '#dcfce7' },
    'improvement':     { text: '#b45309', border: '#fcd34d', bg: '#fef3c7' },
  };
  const c = colours[update.type] ?? { text: '#374151', border: '#d1d5db', bg: '#f3f4f6' };
  const label = TYPE_LABELS[update.type] ?? update.type;
  const preview = (update.body ?? '').replace(/!\[[^\]]*\]\([^)]+\)(\{[^}]+\})?/g, '').replace(/\n+/g, ' ').trim();
  const truncated = preview.length > 120 ? preview.slice(0, 120) + '…' : preview;

  return `
  <div class="mb-incident-card" style="border-left:3px solid ${c.border};background:${c.bg}33;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <strong style="font-size:0.875rem;">${escapeHtml(update.title)}</strong>
      <span style="color:${c.text};font-size:0.75rem;font-weight:700;background:${c.bg};border:1px solid ${c.border};border-radius:4px;padding:1px 6px;">${escapeHtml(label.toUpperCase())}</span>
    </div>
    ${truncated ? `<div style="font-size:0.8125rem;color:var(--mb-text-muted);margin-bottom:6px;">${escapeHtml(truncated)}</div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:0.8rem;color:var(--mb-text-label);">${escapeHtml(update.date)}</span>
      <button type="button" class="more-buttons-button secondary"
              style="font-size:0.8rem;padding:4px 10px;"
              data-edit-system-update="${update.idx}">Edit</button>
    </div>
  </div>`;
}

export function renderSystemUpdates(markdown) {
  const updates = parseUpdateBlocks(markdown);
  if (updates.length === 0) return `<p class="more-buttons-description">No system updates yet.</p>`;
  return updates.map(u => updateCard(u)).join('');
}

// ── Capture helpers ───────────────────────────────────────────────────────────

function updateCapturesList(formEl) {
  const container = formEl.querySelector('#log-update-captures, #edit-update-captures');
  if (!container) return;
  container.innerHTML = pendingCaptures.map((c, i) => `
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px;padding:6px;background:var(--mb-surface);border-radius:6px;border:1px solid var(--mb-border);">
      <img src="${c.lightDataUrl}" style="height:40px;border-radius:3px;border:1px solid var(--mb-border);" />
      <img src="${c.darkDataUrl}" style="height:40px;border-radius:3px;border:1px solid var(--mb-border);" />
      <span style="font-size:0.75rem;color:var(--mb-text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.lightFilename)}</span>
      <button type="button" class="more-buttons-button secondary" style="font-size:0.75rem;padding:2px 8px;"
              data-remove-capture="${i}">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('[data-remove-capture]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingCaptures.splice(parseInt(btn.dataset.removeCapture), 1);
      updateCapturesList(formEl);
    });
  });
}
