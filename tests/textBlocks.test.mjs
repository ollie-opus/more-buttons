import assert from 'node:assert/strict';
import {
  parseBlocks, parseComponents, buildComponentBody, sectionBodyOpts, leadUuid, derivedUuid,
  uuidOfComponent, componentMarkdown, readTabComponents, writeTabBody,
} from '../scripts/components.js';
import { GUIDE_ADMONITION_TYPES_RE as RE } from '../scripts/admonitions.js';
import { OPS, applyOps, findComponent, readContainer, splitParagraphs } from '../scripts/kbPageOps.js';
import { TEXT_KIND } from '../scripts/kbPageRender.js';
import { buildSectionTree } from '../scripts/sections.js';
import { gapIndex, edgeSpeed, gapLineY } from '../scripts/kbPageDrag.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = (id, indent = '') => `${indent}<span data-uuid="${id}" style="display:none"></span>`;
const CAP = id => [span(id), '![](../assets/media/a-light-mode.png#only-light)', '![](../assets/media/a-dark-mode.png#only-dark)'];
const shape = blocks => blocks.map(b => (b.kind === 'text' ? `text:${b.txt.uuid}:${b.txt.body}` : `${b.kind}:${uuidOfComponent(b)}`));

// ── Reading ─────────────────────────────────────────────────────────────────

test('text is a block where it stands, named by the span above it', () => {
  const body = [span('own'), '', span('t1'), 'Lead text.', '', ...CAP('c1'), '', span('t2'), 'After the capture.', '', 'Second paragraph.'].join('\n');
  assert.deepEqual(shape(parseBlocks(body, RE).blocks),
    ['text:t1:Lead text.', 'capture:c1', 'text:t2:After the capture.\n\nSecond paragraph.']);
});

test('parseComponents hands the leading text back apart, with its uuid; later text stays a component', () => {
  const body = [span('own'), '', span('t1'), 'Lead.', '', ...CAP('c1'), '', span('t2'), 'Tail.'].join('\n');
  const p = parseComponents(body, RE);
  assert.equal(p.description, 'Lead.');
  assert.equal(p.descriptionUuid, 't1');
  assert.deepEqual(shape(p.components), ['capture:c1', 'text:t2:Tail.']);
  // Text that does not lead is no description at all.
  const q = parseComponents([span('own'), '', ...CAP('c1'), '', span('t2'), 'Tail.'].join('\n'), RE);
  assert.equal(q.description, '');
  assert.equal(q.descriptionUuid, null);
  assert.deepEqual(shape(q.components), ['capture:c1', 'text:t2:Tail.']);
});

test('a page written before text blocks reads the same way: text keeps its place and gets a steady uuid', () => {
  const legacy = [span('own'), 'Glued description.', '', ...CAP('c1'), '', 'Text nobody gave a span.'].join('\n');
  const a = parseBlocks(legacy, RE).blocks;
  const b = parseBlocks(legacy, RE).blocks;
  assert.deepEqual(a.map(x => x.kind), ['text', 'capture', 'text']);
  assert.equal(a[0].txt.body, 'Glued description.');
  assert.match(a[0].txt.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(shape(a), shape(b), 'the same body always reads the same');
  assert.notEqual(a[0].txt.uuid, a[2].txt.uuid);
  assert.notEqual(a[0].txt.uuid, 'own', 'the container span is never taken for the text');
  // The same words in another container are another block.
  const other = parseBlocks(legacy.replace('"own"', '"own2"'), RE).blocks;
  assert.notEqual(other[0].txt.uuid, a[0].txt.uuid);
});

test('a section body carries no span of its own: its first span is its leading text', () => {
  const body = [span('t1'), 'Section text.', '', ...CAP('c1')].join('\n');
  assert.deepEqual(shape(parseBlocks(body, RE, sectionBodyOpts('sec')).blocks), ['text:t1:Section text.', 'capture:c1']);
});

test('a span that only names the next component is not text; an emptied text block is nothing', () => {
  const body = [span('own'), '', ...CAP('c1'), '', span('orphan'), '', ...CAP('c2')].join('\n');
  assert.deepEqual(shape(parseBlocks(body, RE).blocks), ['capture:c1', 'capture:c2']);
});

// ── Writing ─────────────────────────────────────────────────────────────────

test('buildComponentBody writes each text block under its own span, and it reads back the same', () => {
  const blocks = [
    { kind: 'text', txt: { uuid: 't1', body: 'Lead.' } },
    { kind: 'capture', cap: { uuid: 'c1', lightFilename: 'media/a-light-mode.png', darkFilename: 'media/a-dark-mode.png', dimMode: 'none', dimValue: null } },
    { kind: 'text', txt: { uuid: 't2', body: 'Tail.' } },
    { kind: 'text', txt: { uuid: 't3', body: '   ' } },
  ];
  const body = buildComponentBody('own', '', blocks);
  assert.equal(body.split('\n').slice(0, 4).join('\n'), [span('own'), '', span('t1'), 'Lead.'].join('\n'));
  assert.match(body, new RegExp(`\\n\\n${span('t2')}\\nTail\\.$`));
  assert.doesNotMatch(body, /t3/, 'empty text is not written');
  assert.deepEqual(shape(parseBlocks(body, RE).blocks), ['text:t1:Lead.', 'capture:c1', 'text:t2:Tail.']);
});

test('text that cannot follow its span directly gets a blank line between', () => {
  for (const first of ['- a list', '1. numbered', '> quote', '---', '# Heading', '| a | b |', '<div class="x" markdown>']) {
    const body = buildComponentBody(null, '', [{ kind: 'text', txt: { uuid: 't', body: `${first}\nmore` } }]);
    assert.ok(body.includes(`${span('t')}\n\n${first}`), first);
    const back = parseBlocks(body, RE, sectionBodyOpts('s')).blocks;
    assert.equal(back[0]?.txt?.uuid, 't', `reads back: ${first}`);
  }
  const plain = buildComponentBody(null, '', [{ kind: 'text', txt: { uuid: 't', body: 'Plain words.' } }]);
  assert.ok(plain.includes(`${span('t')}\nPlain words.`));
});

test('the forms keep the leading text\'s identity across a rewrite (leadUuid)', () => {
  const body = [span('own'), '', span('t1'), 'Lead.'].join('\n');
  const prior = parseComponents(body, RE);
  const next = buildComponentBody('own', 'Lead, edited.', prior.components, leadUuid(prior, 'Lead, edited.'));
  assert.equal(parseComponents(next, RE).descriptionUuid, 't1');
  assert.equal(leadUuid(prior, '  '), null);
  assert.match(leadUuid(null, 'new'), /^[0-9a-f-]{36}$/);
  // With no identity handed over the text is still written, and still leads.
  assert.equal(parseComponents(buildComponentBody('own', 'Bare.', []), RE).description, 'Bare.');
});

test('writeTabBody keeps a tab\'s leading text uuid', () => {
  const md = ['# T', span('h'), '', span('g'), '=== "One"', '', span('tab', '    '), '', span('lead', '    '), '    Tab text.', ''].join('\n');
  assert.equal(readTabComponents(md, 'tab').descriptionUuid, 'lead');
  const out = writeTabBody(md, 'tab', 'Changed.', []);
  assert.deepEqual([readTabComponents(out, 'tab').description, readTabComponents(out, 'tab').descriptionUuid], ['Changed.', 'lead']);
});

test('copying a text block gives its words, without the span', () => {
  assert.equal(componentMarkdown({ kind: 'text', txt: { uuid: 't', body: 'Some **words**.' } }), 'Some **words**.');
});

test('derivedUuid is steady and well formed', () => {
  assert.equal(derivedUuid('a|text|0|x'), derivedUuid('a|text|0|x'));
  assert.notEqual(derivedUuid('a|text|0|x'), derivedUuid('a|text|1|x'));
});

// ── Moving (kbPageOps) ──────────────────────────────────────────────────────

const PAGE = [
  '# Page', span('h1'), '', span('ht'), 'Page intro.', '',
  '## First', span('s1'), '', span('s1t'), 'First text.', '',
  '!!! note "Note"', '', span('adm', '    '), '', span('admt', '    '), '    Note text.', '',
  ...CAP('cap'), '',
  '## Second', span('s2'), '', ...CAP('cap2'), '',
  '### Child', span('s3'), '', span('s3t'), 'Child text.', '',
  '## Third', span('s4'), '',
].join('\n');
const section = uuid => ({ kind: TEXT_KIND.section, uuid });
const adm = { kind: TEXT_KIND.admonition, uuid: 'adm' };
const ids = (md, c) => readContainer(md, c).components.map(uuidOfComponent);
const run = (md, ...ops) => applyOps(md, ops);

test('moveTo: text goes below a component, in its own container', () => {
  assert.deepEqual(ids(PAGE, section('s1')), ['s1t', 'adm', 'cap']);
  const out = run(PAGE, OPS.moveTo('s1t', section('s1'), 3)); // after the last block
  assert.deepEqual(ids(out, section('s1')), ['adm', 'cap', 's1t']);
  assert.equal(findComponent(out, 's1t').component.txt.body, 'First text.');
  assert.equal(run(PAGE, OPS.moveTo('s1t', section('s1'), 0)), PAGE, 'where it already is: unchanged');
  assert.equal(run(PAGE, OPS.moveTo('s1t', section('s1'), 1)), PAGE, 'the gap just under it is where it is too');
});

test('moveTo: across containers, in and out of an admonition, keeping identity', () => {
  let out = run(PAGE, OPS.moveTo('cap', adm, 0));
  assert.deepEqual(ids(out, adm), ['cap', 'admt']);
  assert.deepEqual(ids(out, section('s1')), ['s1t', 'adm']);
  out = run(out, OPS.moveTo('admt', section('s2'), 99));
  assert.deepEqual(ids(out, section('s2')), ['cap2', 'admt']);
  assert.deepEqual(ids(out, adm), ['cap']);
  // A page description below an admonition: the leading text is a block like any other.
  out = run(PAGE, OPS.moveTo('ht', section('s1'), 2));
  assert.deepEqual(ids(out, section('h1')), []);
  assert.deepEqual(ids(out, section('s1')), ['s1t', 'adm', 'ht', 'cap']);
});

test('moveTo: nothing lands inside itself; a missing block or place says so', () => {
  assert.equal(run(PAGE, OPS.moveTo('adm', adm, 0)), PAGE);
  assert.throws(() => run(PAGE, OPS.moveTo('gone', section('s1'), 0)), /no longer in the draft/);
  assert.throws(() => run(PAGE, OPS.moveTo('cap', section('gone'), 0)), /no longer in the draft/);
});

test('moveTo replays over a draft that changed underneath it', () => {
  const theirs = run(PAGE, OPS.deleteComponent('cap2'));
  const out = applyOps(theirs, [OPS.moveTo('s1t', section('s2'), 5)]);
  assert.deepEqual(ids(out, section('s2')), ['s1t']);
});

test('putText: typing into an empty place makes the block; emptying a block takes it away', () => {
  let out = run(PAGE, OPS.putText('new', 'Typed.', section('s4'), 0));
  assert.deepEqual(ids(out, section('s4')), ['new']);
  out = run(out, OPS.putText('new', 'Typed more.', section('s4'), 0));
  assert.equal(findComponent(out, 'new').component.txt.body, 'Typed more.');
  out = run(out, OPS.putText('new', '  '));
  assert.equal(findComponent(out, 'new'), null);
  assert.equal(run(PAGE, OPS.putText('new', '', section('s4'), 0)), PAGE, 'nothing typed: nothing made');
  // Between two blocks.
  out = run(PAGE, OPS.putText('mid', 'Between.', section('s1'), 2));
  assert.deepEqual(ids(out, section('s1')), ['s1t', 'adm', 'mid', 'cap']);
});

test('setText still means the leading text', () => {
  let out = run(PAGE, OPS.setText(section('s1'), 'Changed.'));
  assert.deepEqual(ids(out, section('s1')), ['s1t', 'adm', 'cap']);
  assert.equal(readContainer(out, section('s1')).description, 'Changed.');
  out = run(PAGE, OPS.setText(section('s2'), 'Now it has some.', 'fresh'));
  assert.deepEqual(ids(out, section('s2')), ['fresh', 'cap2']);
  out = run(PAGE, OPS.setText(section('s1'), ''));
  assert.deepEqual(ids(out, section('s1')), ['adm', 'cap']);
});

test('splitText / joinText: a block per paragraph, and back', () => {
  const md = run(PAGE, OPS.putText('s1t', 'One.\n\nTwo.\n\n- a\n- b\n\n- c\n\nThree.'));
  assert.deepEqual(splitParagraphs('One.\n\nTwo.\n\n- a\n- b\n\n- c\n\nThree.'), ['One.', 'Two.', '- a\n- b\n\n- c', 'Three.']);
  assert.deepEqual(splitParagraphs('```\na\n\nb\n```\n\nAfter.'), ['```\na\n\nb\n```', 'After.']);
  const split = run(md, OPS.splitText('s1t', ['p2', 'p3', 'p4']));
  assert.deepEqual(ids(split, section('s1')), ['s1t', 'p2', 'p3', 'p4', 'adm', 'cap']);
  assert.equal(findComponent(split, 'p3').component.txt.body, '- a\n- b\n\n- c');
  assert.equal(run(split, OPS.splitText('p2', [])), split, 'one paragraph: nothing to cut');
  const joined = run(split, OPS.joinText('p2'));
  assert.deepEqual(ids(joined, section('s1')), ['s1t', 'p3', 'p4', 'adm', 'cap']);
  assert.equal(findComponent(joined, 's1t').component.txt.body, 'One.\n\nTwo.');
  assert.equal(run(split, OPS.joinText('s1t')), split, 'nothing above: unchanged');
});

test('moveSectionTo: among its own level, and a subsection under another section', () => {
  const order = md => buildSectionTree(md).sections.map(s => `${s.level}:${s.uuid}`).join(' ');
  assert.equal(order(PAGE), '1:h1 2:s1 2:s2 3:s3 2:s4');
  assert.equal(order(run(PAGE, OPS.moveSectionTo('s4', null, 0))), '1:h1 2:s4 2:s1 2:s2 3:s3');
  assert.equal(order(run(PAGE, OPS.moveSectionTo('s1', null, 3))), '1:h1 2:s2 3:s3 2:s4 2:s1');
  assert.equal(order(run(PAGE, OPS.moveSectionTo('s2', null, 0))), '1:h1 2:s2 3:s3 2:s1 2:s4', 'a section takes its subsections');
  assert.equal(run(PAGE, OPS.moveSectionTo('s2', null, 1)), PAGE, 'where it already is');
  assert.equal(run(PAGE, OPS.moveSectionTo('s2', null, 2)), PAGE);
  assert.equal(order(run(PAGE, OPS.moveSectionTo('s3', 's1', 0))), '1:h1 2:s1 3:s3 2:s2 2:s4');
  const out = run(PAGE, OPS.moveSectionTo('s3', 's1', 0));
  assert.equal(findComponent(out, 's3t').container.uuid, 's3', 'its content goes with it');
  assert.throws(() => run(PAGE, OPS.moveSectionTo('h1', null, 1)), /no longer in the draft/);
});

// ── Drag geometry ───────────────────────────────────────────────────────────

test('gapIndex: the gap the pointer is in, counted from the blocks\' middles', () => {
  assert.equal(gapIndex([], 50), 0);
  assert.equal(gapIndex([100, 200, 300], 50), 0);
  assert.equal(gapIndex([100, 200, 300], 150), 1);
  assert.equal(gapIndex([100, 200, 300], 999), 3);
});

test('gapLineY: between two blocks, clear of the first and the last, or the empty spot', () => {
  const boxes = [{ top: 10, bottom: 30 }, { top: 50, bottom: 90 }];
  assert.equal(gapLineY(boxes, 1, 0), 40);
  assert.ok(gapLineY(boxes, 0, 0) < 10);
  assert.ok(gapLineY(boxes, 2, 0) > 90);
  assert.equal(gapLineY([], 0, 77), 77);
});

test('edgeSpeed: still in the middle, faster the nearer the edge, up at the top', () => {
  assert.equal(edgeSpeed(400, 0, 800), 0);
  assert.ok(edgeSpeed(10, 0, 800) < 0);
  assert.ok(edgeSpeed(790, 0, 800) > 0);
  assert.ok(edgeSpeed(795, 0, 800) > edgeSpeed(750, 0, 800));
  assert.equal(edgeSpeed(50, 0, 100), 0, 'a view too short to have edges does not scroll');
});

console.log(`\ntextBlocks: ${passed} passed`);
