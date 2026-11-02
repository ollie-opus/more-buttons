import assert from 'node:assert/strict';
import { commitMessage, parseCommitMessage, classifySubject, changedFieldLabels, RULE_LABELS, SESSION_START_RULES, COMMIT_TRAILER } from '../scripts/editLogGrammar.js';
let passed = 0; function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('commitMessage: subject only, and subject + body lines, both end with the trailer', () => {
  assert.equal(commitMessage("Edited section 'Setup'"), "Edited section 'Setup'\n\nPublished via More Buttons Chrome Extension");
  assert.equal(commitMessage("Edited update 'X'", ['Changed: Title, Description', 'Item: u-1']),
    "Edited update 'X'\n\nChanged: Title, Description\nItem: u-1\n\nPublished via More Buttons Chrome Extension");
});
test('parseCommitMessage: strips the trailer, lifts Changed:/Item: lines, keeps the rest as body', () => {
  const p = parseCommitMessage("Edited update 'X'\n\nChanged: Title, Description\nItem: u-1\nfree text\n\n" + COMMIT_TRAILER);
  assert.deepEqual(p, { subject: "Edited update 'X'", body: 'free text', trailers: { changed: 'Title, Description', item: 'u-1' } });
});
test('parseCommitMessage: legacy / foreign messages (CRLF, no trailer, no blank line) parse without throwing', () => {
  assert.deepEqual(parseCommitMessage('Update foo bar\r\n\r\nPublished via More Buttons Chrome Extension\r\n'), { subject: 'Update foo bar', body: '', trailers: {} });
  assert.deepEqual(parseCommitMessage('fix typo'), { subject: 'fix typo', body: '', trailers: {} });
  assert.deepEqual(parseCommitMessage('Subject\nbody line\nPublished via More Buttons Chrome Extension'), { subject: 'Subject', body: 'body line', trailers: {} });
});
test('classifySubject: the five rule prefixes', () => {
  assert.deepEqual(classifySubject('Create guide: Onboarding'), { kind: 'rule', rule: 'guide-created', title: 'Onboarding' });
  assert.deepEqual(classifySubject('Create draft: Onboarding'), { kind: 'rule', rule: 'draft-created', title: 'Onboarding' });
  assert.deepEqual(classifySubject('Publish: Onboarding'), { kind: 'rule', rule: 'published', title: 'Onboarding' });
  assert.deepEqual(classifySubject("Publish update: 'Checklist'"), { kind: 'rule', rule: 'published', title: "'Checklist'" });
  assert.deepEqual(classifySubject('Discard draft: Onboarding'), { kind: 'rule', rule: 'draft-discarded', title: 'Onboarding' });
  assert.equal(RULE_LABELS['draft-created'], 'New draft created');
  assert.ok(SESSION_START_RULES.has('guide-created') && SESSION_START_RULES.has('draft-created') && !SESSION_START_RULES.has('published'));
});
test('classifySubject: pre-feature fallbacks are muted; descriptive subjects are verbatim', () => {
  assert.deepEqual(classifySubject('Update onboarding'), { kind: 'bubble', text: 'Updated the page', muted: true });
  assert.deepEqual(classifySubject('Delete onboarding'), { kind: 'bubble', text: 'Draft file removed', muted: true });
  assert.deepEqual(classifySubject('Updated page format'), { kind: 'bubble', text: 'Updated page format', muted: true });
  assert.deepEqual(classifySubject("Edited section 'Setup'"), { kind: 'bubble', text: "Edited section 'Setup'", muted: false });
  assert.deepEqual(classifySubject('create draft: lower'), { kind: 'bubble', text: 'create draft: lower', muted: false });
});
test('changedFieldLabels: differing resolved values, in spec order, skipping undefined and unknown-to-snapshot', () => {
  const specs = [{ name: 'a', label: 'Title' }, { name: 'b', label: 'Description' }, { name: 'c', label: 'Hide' }, { name: 'd', label: 'Order' }];
  assert.deepEqual(changedFieldLabels({ a: 'x', b: 'y', c: false }, { a: 'z', b: 'y', c: true, d: 'u1' }, specs), ['Title', 'Hide']);
  assert.deepEqual(changedFieldLabels({ a: 'x', d: 'u1,u2' }, { a: 'x', d: undefined }, specs), []);
});
console.log(`\n${passed} passed`);
