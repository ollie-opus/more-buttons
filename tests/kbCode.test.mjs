import assert from 'node:assert/strict';
import {
  ANN, toModel, fromModel, modelHtml, codeInnerHtml, markerLines,
  hlLineSet, hlLineString, toggleHlLine, shiftHlLines, filledLines, lineNumbers,
} from '../scripts/kbCode.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; };

test('model: markers become one placeholder each, and come back in the language\'s style', () => {
  const code = '/snooze for x # (1)!\nnext\ny = 2 # (2)!';
  assert.equal(toModel(code), `/snooze for x${ANN}\nnext\ny = 2${ANN}`);
  assert.equal(fromModel(toModel(code), 'bash'), code);
  assert.equal(fromModel(toModel(code), 'js'), '/snooze for x // (1)!\nnext\ny = 2 // (2)!');
  assert.equal(fromModel('plain', 'bash'), 'plain');
});

test('html: bubbles in Zensical\'s markup, numbered in order, text escaped', () => {
  const html = codeInnerHtml('a < b # (1)!');
  assert.match(html, /^a &lt; b<span class="md-annotation mb-kb-ann" contenteditable="false" data-mb-ann="0"><span class="md-annotation__index"><span data-md-annotation-id="1"><\/span><\/span><\/span>$/);
  assert.equal(modelHtml('x\n'), 'x\n<br>', 'an empty last line keeps a line to stand on');
});

test('marker lines: the line each annotation stands on', () => {
  assert.deepEqual(markerLines('a # (1)!\nb\nc # (2)!'), [0, 2]);
  assert.deepEqual(markerLines('none'), []);
});

test('highlighted lines: read, written compactly, toggled', () => {
  assert.deepEqual([...hlLineSet('2 3-5')].sort(), [1, 2, 3, 4]);
  assert.equal(hlLineString(new Set([0, 1, 2, 4])), '1-3 5');
  assert.equal(hlLineString(new Set()), '');
  assert.equal(toggleHlLine('', 1), '2');
  assert.equal(toggleHlLine('2 3', 1), '3');
  assert.equal(toggleHlLine('1 3', 1), '1-3');
});

test('highlighted lines follow their lines through an edit', () => {
  // A line added above the highlight moves it down.
  assert.equal(shiftHlLines('3', 'a\nb\nc', 'new\na\nb\nc'), '4');
  // Typing in a line keeps it.
  assert.equal(shiftHlLines('2', 'a\nb\nc', 'a\nbb\nc'), '2');
  // A line deleted above moves it up.
  assert.equal(shiftHlLines('3', 'a\nb\nc', 'a\nc'), '2');
  // The highlighted line itself deleted: it goes.
  assert.equal(shiftHlLines('2', 'a\nb\nc', 'a\nc'), '');
  // Enter at the end of a highlighted line: it stays where it was.
  assert.equal(shiftHlLines('1', 'a\nb', 'a\n\nb'), '1');
});

test('line numbers from the start number; filled lines (a bubble counts)', () => {
  assert.equal(lineNumbers(3, '1'), '1\n2\n3');
  assert.equal(lineNumbers(2, '9'), '9\n10');
  assert.equal(lineNumbers(1, ''), '1');
  assert.deepEqual(filledLines('a\n  \n# (1)!\n'), [true, false, true, false]);
});

console.log(`kbCode: ${passed} passed`);
