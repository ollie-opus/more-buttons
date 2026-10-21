import assert from 'node:assert/strict';
import { pageMatchesUrl, compilePageMatch } from '../scripts/utils.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const U = 'https://cloud.opus-safety.co.uk/admin/sites/0f1e-abc/documents/edit?x=1';

test('compilePageMatch returns a predicate with the same answers as pageMatchesUrl', () => {
  const rules = [
    { mode: 'and', keywords: ['documents', 'edit'] },
    { mode: 'and', keywords: ['documents', '!edit'] },
    { mode: 'or', keywords: ['nope', 'EDIT'] },
    { mode: 'or', keywords: ['nope'] },
    { mode: 'and', keywords: [['nope'], ['documents', '!new']] },
    { mode: 'and', keywords: ['REGEX:^https:\\/\\/cloud\\.opus-safety\\.co\\.uk\\/admin\\/sites\\/[a-f0-9-]+\\/documents'] },
    { mode: 'and', keywords: ['REGEX:[unclosed'] },
    { mode: 'weird', keywords: ['documents'] },
    null,
    { mode: 'and' },
  ];
  for (const rule of rules) {
    assert.equal(compilePageMatch(rule)(U), pageMatchesUrl(rule, U), JSON.stringify(rule));
  }
});

test('expected truth table', () => {
  assert.equal(compilePageMatch({ mode: 'and', keywords: ['documents', 'edit'] })(U), true);
  assert.equal(compilePageMatch({ mode: 'and', keywords: ['documents', '!edit'] })(U), false);
  assert.equal(compilePageMatch({ mode: 'or', keywords: ['nope', 'EDIT'] })(U), true);
  assert.equal(compilePageMatch({ mode: 'or', keywords: ['nope'] })(U), false);
  assert.equal(compilePageMatch({ mode: 'and', keywords: [['nope'], ['documents', '!new']] })(U), true);
  assert.equal(compilePageMatch({ mode: 'and', keywords: ['REGEX:[unclosed'] })(U), false);
  assert.equal(compilePageMatch({ mode: 'weird', keywords: ['documents'] })(U), false);
  assert.equal(compilePageMatch(null)(U), true);
  assert.equal(compilePageMatch({ mode: 'and' })(U), true);
});

test('regexes are tested against the lower-cased url (existing semantics)', () => {
  const p = compilePageMatch({ mode: 'and', keywords: ['REGEX:/ADMIN/'] });
  assert.equal(p(U), false);
  assert.equal(compilePageMatch({ mode: 'and', keywords: ['REGEX:/admin/'] })('https://X/ADMIN/'), true);
});

test('regex is compiled once per rule, not once per call', () => {
  const orig = globalThis.RegExp;
  let constructed = 0;
  globalThis.RegExp = class extends orig { constructor(...a) { super(...a); constructed++; } };
  try {
    const p = compilePageMatch({ mode: 'and', keywords: ['REGEX:documents', 'REGEX:edit'] });
    assert.equal(constructed, 2);
    p(U); p(U); p('https://other/');
    assert.equal(constructed, 2);
  } finally { globalThis.RegExp = orig; }
});

test('pageMatchesUrl memoises the compiled rule per rule object', () => {
  const orig = globalThis.RegExp;
  let constructed = 0;
  globalThis.RegExp = class extends orig { constructor(...a) { super(...a); constructed++; } };
  try {
    const rule = { mode: 'and', keywords: ['REGEX:documents'] };
    pageMatchesUrl(rule, U); pageMatchesUrl(rule, U); pageMatchesUrl(rule, 'https://other/');
    assert.equal(constructed, 1);
  } finally { globalThis.RegExp = orig; }
});

console.log(`\n${passed} passed`);
