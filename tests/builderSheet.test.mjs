import assert from 'node:assert/strict';
import {
  parseClipboardTsv, parseMulti, formatMulti,
  columnsFromPicks, matchModes, choiceTexts, checkCell, problems, a1, switchMatchOn,
  rowHasData, fillButtonDefaults, clipPaste, keepInBody,
} from '../scripts/builderSheet.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const TYPES = ['Cleaning & Environmental Services', 'Grounds, Landscaping & Tree Services', 'Mechanical & Electrical', '+Gas Works'];

test('parseClipboardTsv splits rows and cells and drops one trailing newline', () => {
  assert.deepEqual(parseClipboardTsv('a\tb\r\nc\td\n'), [['a', 'b'], ['c', 'd']]);
});

test('a quoted cell keeps its line breaks and doubled quotes', () => {
  assert.deepEqual(parseClipboardTsv('x\t"line 1\nline ""2"""\ty\nz'), [['x', 'line 1\nline "2"', 'y'], ['z']]);
});

test('a cell that merely starts with a quote is left as it is', () => {
  assert.deepEqual(parseClipboardTsv('"Grounds, Landscaping", +Gas Works\tb'), [['"Grounds, Landscaping", +Gas Works', 'b']]);
  assert.deepEqual(parseClipboardTsv('"unclosed\tb'), [['"unclosed', 'b']]);
});

test('parseMulti reads comma separated answers', () => {
  assert.deepEqual(parseMulti('Mechanical & Electrical, +Gas Works', TYPES), { items: ['Mechanical & Electrical', '+Gas Works'], bad: [] });
});

test('a quoted answer may contain a comma', () => {
  assert.deepEqual(parseMulti('"Grounds, Landscaping & Tree Services", +Gas Works', TYPES), { items: ['Grounds, Landscaping & Tree Services', '+Gas Works'], bad: [] });
});

test('an unquoted answer with a comma is recognised when its pieces join into one choice', () => {
  assert.deepEqual(parseMulti('+Gas Works, Grounds, Landscaping & Tree Services', TYPES), { items: ['+Gas Works', 'Grounds, Landscaping & Tree Services'], bad: [] });
});

test('a cell that is exactly one choice is that choice', () => {
  assert.deepEqual(parseMulti('Grounds, Landscaping & Tree Services', TYPES), { items: ['Grounds, Landscaping & Tree Services'], bad: [] });
});

test('spaces around commas do not count, but capitals do', () => {
  assert.deepEqual(parseMulti('  +Gas Works ,Mechanical & Electrical  ', TYPES), { items: ['+Gas Works', 'Mechanical & Electrical'], bad: [] });
  assert.deepEqual(parseMulti('+gas works', TYPES), { items: [], bad: ['+gas works'] });
});

test('unknown answers are reported, repeats dropped, empty pieces ignored', () => {
  assert.deepEqual(parseMulti('+Gas Works, Scafolding, , +Gas Works', TYPES), { items: ['+Gas Works'], bad: ['Scafolding'] });
});

test('formatMulti quotes answers that contain a comma or a quote', () => {
  assert.equal(formatMulti(['Grounds, Landscaping & Tree Services', '+Gas Works']), '"Grounds, Landscaping & Tree Services", +Gas Works');
  assert.equal(formatMulti(['Say "hi"']), '"Say ""hi"""');
  assert.equal(formatMulti([]), '');
});

test('formatMulti output parses back to the same answers', () => {
  const picked = ['Grounds, Landscaping & Tree Services', 'Cleaning & Environmental Services'];
  assert.deepEqual(parseMulti(formatMulti(picked), TYPES).items, picked);
});

const pick = (kind, title, targetType, target, extra = {}) =>
  ({ key: `${kind}:${targetType}:${target}`, kind, title, typeLabel: kind, targetType, target, choices: null, submit: false, elements: [], ...extra });

const NAME = pick('text', 'contractor[name]', 'name', 'contractor[name]');
const COMMENT = pick('textarea', 'contractor[comment]', 'name', 'contractor[comment]');
const KIND = pick('radioGroup', 'contractor[kind]', 'name', 'contractor[kind]', { choices: [
  { label: 'Company', value: 'company', id: 'kind_company' }, { label: 'Sole Trader', value: 'sole_trader', id: 'kind_sole' }] });
const TYPES_PICK = pick('checkboxGroup', 'contractor[types][]', 'name', 'contractor[types][]', {
  choices: TYPES.map((label, i) => ({ label, value: String(i + 1), id: '' })) });
const OWNER = pick('select', 'owned_by', 'id', 'contractor_owned_by', { choices: [
  { label: 'Opus Safety', value: '17', id: '' }, { label: 'Ollie Test Site 1', value: '42', id: '' }] });
const ACTIVE = pick('checkbox', 'contractor[active]', 'id', 'contractor_active');
const SAVE = pick('button', 'Create contractor', 'css', 'button.inline-flex', { submit: true });
const OPEN = pick('button', 'Open', 'css', 'button[data-action="panel#open"]');

test('columnsFromPicks keeps pick order and starts choice columns on label', () => {
  const cols = columnsFromPicks([NAME, KIND, SAVE]);
  assert.deepEqual(cols.map(c => [c.title, c.kind, c.matchOn]),
    [['contractor[name]', 'text', null], ['contractor[kind]', 'radioGroup', 'label'], ['Create contractor', 'button', null]]);
  assert.equal('elements' in cols[0], false);
});

test('matchModes offers id only when every choice has one', () => {
  const [kind, types, name] = columnsFromPicks([KIND, TYPES_PICK, NAME]);
  assert.deepEqual(matchModes(kind), ['label', 'value', 'id']);
  assert.deepEqual(matchModes(types), ['label', 'value']);
  assert.deepEqual(matchModes(name), []);
});

test('choiceTexts follows the column mode, and covers checkboxes and buttons', () => {
  const [kind, active, save, open, name] = columnsFromPicks([KIND, ACTIVE, SAVE, OPEN, NAME]);
  assert.deepEqual(choiceTexts(kind), ['Company', 'Sole Trader']);
  kind.matchOn = 'value';
  assert.deepEqual(choiceTexts(kind), ['company', 'sole_trader']);
  assert.deepEqual(choiceTexts(active), ['TRUE', 'FALSE']);
  assert.deepEqual(choiceTexts(save), ['submit', 'click']);
  assert.deepEqual(choiceTexts(open), ['click']);
  assert.deepEqual(choiceTexts(name), []);
});

test('checkCell: blank is fine, text is trimmed, choices are exact', () => {
  const [name, kind] = columnsFromPicks([NAME, KIND]);
  assert.deepEqual(checkCell(name, '   '), { ok: true, items: [] });
  assert.deepEqual(checkCell(name, '  Acme Ltd \n'), { ok: true, items: ['Acme Ltd'] });
  assert.deepEqual(checkCell(kind, ' Sole Trader '), { ok: true, items: ['Sole Trader'] });
  assert.deepEqual(checkCell(kind, 'sole trader'), { ok: false, message: 'not a choice for contractor[kind]. choices: Company, Sole Trader' });
});

test('checkCell: a text shared by two choices is refused', () => {
  const [dup] = columnsFromPicks([{ ...KIND, choices: [{ label: 'Yes', value: '1', id: '' }, { label: 'Yes', value: '2', id: '' }] }]);
  assert.deepEqual(checkCell(dup, 'Yes'), { ok: false, message: 'two choices share this text, switch the column to value or id' });
});

test('checkCell: checkbox groups, lone checkboxes and buttons', () => {
  const [types, active, save, open] = columnsFromPicks([TYPES_PICK, ACTIVE, SAVE, OPEN]);
  assert.deepEqual(checkCell(types, '"Grounds, Landscaping & Tree Services", +Gas Works'), { ok: true, items: ['Grounds, Landscaping & Tree Services', '+Gas Works'] });
  assert.match(checkCell(types, '+Gas Works, Scafolding').message, /^"Scafolding" is not a choice for contractor\[types\]\[\]/);
  assert.deepEqual(checkCell(active, 'TRUE'), { ok: true, items: ['TRUE'] });
  assert.equal(checkCell(active, 'true').ok, false);
  assert.deepEqual(checkCell(save, 'click'), { ok: true, items: ['click'] });
  assert.equal(checkCell(open, 'submit').ok, false);
});

test('a typed input refuses what the browser would throw away', () => {
  const [date] = columnsFromPicks([pick('text', 'starts_on', 'name', 'starts_on', { typeLabel: 'date' })]);
  const accepts = (type, text) => type !== 'date' || /^\d{4}-\d{2}-\d{2}$/.test(text);
  assert.deepEqual(checkCell(date, '2025-05-13', { accepts }), { ok: true, items: ['2025-05-13'] });
  assert.deepEqual(checkCell(date, '13/05/2025', { accepts }), { ok: false, message: 'this date field will not accept "13/05/2025". dates must be yyyy-mm-dd' });
  assert.deepEqual(checkCell(date, '13/05/2025'), { ok: true, items: ['13/05/2025'] }); // no probe supplied
  const [num] = columnsFromPicks([pick('text', 'qty', 'name', 'qty', { typeLabel: 'number' })]);
  assert.deepEqual(checkCell(num, '1,200', { accepts: () => false }), { ok: false, message: 'this number field will not accept "1,200"' });
  const [plain] = columnsFromPicks([NAME]);
  assert.equal(checkCell(plain, 'anything', { accepts: () => false }).ok, true); // plain text is never probed
});

test('problems lists bad cells by sheet reference, the header being row 1', () => {
  const cols = columnsFromPicks([NAME, KIND]);
  const rows = [['Acme', 'Company'], ['Northfield', 'Limited company'], ['', '']];
  assert.deepEqual(problems(cols, rows).map(p => [p.row, p.col, p.ref, p.text]), [[1, 1, 'B3', 'Limited company']]);
  assert.equal(a1(0, 0), 'A2');
  assert.equal(a1(2, 27), 'AB4');
});

test('switchMatchOn rewrites valid cells to the same choice and leaves the rest', () => {
  const cols = columnsFromPicks([KIND, TYPES_PICK]);
  const rows = [['Sole Trader', '"Grounds, Landscaping & Tree Services", +Gas Works'], ['Limited company', ''], ['', '']];
  switchMatchOn(cols, rows, 0, 'value');
  switchMatchOn(cols, rows, 1, 'value');
  assert.equal(cols[0].matchOn, 'value');
  assert.deepEqual(rows, [['sole_trader', '2, 4'], ['Limited company', ''], ['', '']]);
  assert.throws(() => switchMatchOn(cols, rows, 1, 'id'), /id is not available/);
});

test('rowHasData ignores button columns', () => {
  const cols = columnsFromPicks([NAME, SAVE]);
  assert.equal(rowHasData(cols, ['', 'submit']), false);
  assert.equal(rowHasData(cols, ['Acme', '']), true);
});

test('fillButtonDefaults fills blank button cells of the named rows only', () => {
  const cols = columnsFromPicks([NAME, SAVE, OPEN]);
  const rows = [['Acme', '', ''], ['Brightside', 'click', ''], ['', '', '']];
  fillButtonDefaults(cols, rows, [0, 1]);
  assert.deepEqual(rows, [['Acme', 'submit', 'click'], ['Brightside', 'click', 'click'], ['', '', '']]);
});

test('clipPaste never adds columns and adds rows as needed', () => {
  const st = { align: ['left', 'left'], header: ['a', 'b'], rows: [['', '']], selected: { row: 0, col: 1 }, anchor: null };
  clipPaste(st, [['x', 'dropped'], ['y', 'dropped']]);
  assert.deepEqual(st.rows, [['', 'x'], ['', 'y']]);
  assert.equal(st.align.length, 2);
});

test('keepInBody stops the selection reaching the header row', () => {
  const st = { align: ['left'], header: ['a'], rows: [['']], selected: { row: -1, col: 0 }, anchor: { row: -1, col: 0 } };
  keepInBody(st);
  assert.deepEqual([st.selected.row, st.anchor.row], [0, 0]);
});

console.log(`\n${passed} passed`);
