// Edit log commit-message grammar: build, parse and classify. Pure leaf module
// (no imports, no browser APIs) so it runs under Node tests.

export const COMMIT_TRAILER = 'Published via More Buttons Chrome Extension';

export const RULE_LABELS = {
  'guide-created': 'Guide created',
  'draft-created': 'New draft created',
  'published': 'Published to live',
  'draft-discarded': 'Draft discarded',
};

export const SESSION_START_RULES = new Set(['guide-created', 'draft-created']);

const RULE_PREFIXES = [
  ['Create guide: ', 'guide-created'],
  ['Create draft: ', 'draft-created'],
  ['Publish update: ', 'published'],
  ['Publish: ', 'published'],
  ['Discard draft: ', 'draft-discarded'],
];

export function commitMessage(subject, bodyLines = []) {
  const body = bodyLines.length ? bodyLines.join('\n') + '\n\n' : '';
  return subject + '\n\n' + body + COMMIT_TRAILER;
}

export function parseCommitMessage(message) {
  const lines = String(message ?? '').split('\n').map((l) => l.replace(/\r$/, ''));
  const subject = lines.shift() ?? '';
  const trailers = {};
  const rest = [];
  for (const line of lines) {
    if (line === COMMIT_TRAILER) continue;
    const m = /^(Changed|Item): (.+)$/.exec(line);
    if (m) trailers[m[1].toLowerCase()] = m[2];
    else rest.push(line);
  }
  return { subject, body: rest.join('\n').trim(), trailers };
}

export function classifySubject(subject) {
  for (const [prefix, rule] of RULE_PREFIXES) {
    if (subject.startsWith(prefix)) return { kind: 'rule', rule, title: subject.slice(prefix.length) };
  }
  if (/^Update /.test(subject)) return { kind: 'bubble', text: 'Updated the page', muted: true };
  if (/^Delete /.test(subject)) return { kind: 'bubble', text: 'Draft file removed', muted: true };
  if (subject === 'Updated page format') return { kind: 'bubble', text: subject, muted: true };
  return { kind: 'bubble', text: subject, muted: false };
}

export function changedFieldLabels(snap, resolved, fieldSpecs) {
  return fieldSpecs
    .filter((s) => s.name in snap && resolved[s.name] !== undefined
      && JSON.stringify(resolved[s.name]) !== JSON.stringify(snap[s.name]))
    .map((s) => s.label);
}
