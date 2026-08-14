import assert from 'node:assert/strict';
import { buildComponentBody, parseComponents } from '../scripts/components.js';
import { buildGrid, locateGrids } from '../scripts/grid.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const SPAN = '<span data-uuid="U-1" style="display:none"></span>';

// python-markdown won't let a list interrupt a paragraph: a uuid span glued
// directly above `- item` lines lazily absorbs them into one paragraph on the
// published page ("- a - b - c" as running text). These blocks need a blank
// line after the span.

test('list-first description gets a blank line after the uuid span', () => {
  const body = buildComponentBody('U-1', '- item one\n- item two', []);
  assert.equal(body, `${SPAN}\n\n- item one\n- item two`);
});

test('ordered-list-first description gets a blank line after the uuid span', () => {
  const body = buildComponentBody('U-1', '1. first\n2. second', []);
  assert.equal(body, `${SPAN}\n\n1. first\n2. second`);
});

test('star/plus list markers also get the blank line', () => {
  assert.equal(buildComponentBody('U-1', '* a', []), `${SPAN}\n\n* a`);
  assert.equal(buildComponentBody('U-1', '+ a', []), `${SPAN}\n\n+ a`);
});

test('blockquote / fence / table starts get the blank line', () => {
  assert.equal(buildComponentBody('U-1', '> quoted', []), `${SPAN}\n\n> quoted`);
  assert.equal(buildComponentBody('U-1', '```\nx\n```', []), `${SPAN}\n\n\`\`\`\nx\n\`\`\``);
  assert.equal(buildComponentBody('U-1', '| a | b |\n|---|---|', []), `${SPAN}\n\n| a | b |\n|---|---|`);
});

// The glue is load-bearing for plain text: it keeps the hidden span inside the
// first paragraph instead of minting an empty <p> above every description.

test('paragraph-first description stays glued to the uuid span', () => {
  const body = buildComponentBody('U-1', 'Just some text.\nSecond line.', []);
  assert.equal(body, `${SPAN}\nJust some text.\nSecond line.`);
});

test('dash inside a paragraph line does not trigger the gap', () => {
  const body = buildComponentBody('U-1', 'Well - hyphenated text.', []);
  assert.equal(body, `${SPAN}\nWell - hyphenated text.`);
});

test('no-uuid body is unchanged', () => {
  assert.equal(buildComponentBody(null, '- item one', []), '- item one');
});

// Round-trip: the blank line must not break identity detection or re-editing.

test('parseComponents round-trips a list-first description', () => {
  const body = buildComponentBody('U-1', '- item one\n- item two', []);
  const { description, components } = parseComponents(body, /step|note|tip/);
  assert.equal(description, '- item one\n- item two');
  assert.equal(components.length, 0);
});

test('locateGrids still finds the cell uuid with the blank line present', () => {
  const cellBody = buildComponentBody('CELL-1', '- item one\n- item two', []);
  const md = buildGrid('GRID-1', 'generic', [{ body: cellBody }, { body: '' }]);
  const grids = locateGrids(md);
  assert.equal(grids.length, 1);
  assert.equal(grids[0].cells[0].uuid, 'CELL-1');
  // The list must sit under a blank line inside the emitted cell.
  assert.ok(md.includes('display:none"></span>\n\n- item one'));
});

console.log(`\n${passed} passed`);
