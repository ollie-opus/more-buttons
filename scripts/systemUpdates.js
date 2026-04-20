import { registerFormAction } from './formActions.js';
import { githubFetchAndPushFile, githubPushImageIfNotExists } from './github.js';
import { createForm } from './form.js';
import { captureElement, setCaptureStoreMode } from './captureElement.js';

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
  const ordinal = (v >= 11 && v <= 13) ? 'th' : (['th','st','nd','rd'][day % 10] ?? 'th');
  return `${day}${ordinal} ${MONTH_NAMES[month - 1]} ${year}`;
}

function parseDateStr(formattedDate) {
  const m = formattedDate.match(/^(\d+)\w*\s+(\w+)\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTH_NAMES.indexOf(m[2]) + 1;
  return { year: parseInt(m[3]), month, day: parseInt(m[1]) };
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

  const descLines = (update.description ?? '').split('\n').map(l => l.length ? '    ' + l : l);
  const captureLines = captures.flatMap(c => [
    '',
    `    ![](../assets/${c.lightFilename}#only-light){ width="700" loading=lazy }`,
    `    ![](../assets/${c.darkFilename}#only-dark){ width="700" loading=lazy }`,
  ]);

  return [header, '', ...descLines, ...captureLines].join('\n');
}
