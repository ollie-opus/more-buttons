import assert from 'node:assert/strict';
import { parseComponents, buildComponentBody, imageDimFields, uuidOfComponent, componentMarkdown, parsePastedComponents } from '../scripts/components.js';

const ADM_RE = /note|tip|step/;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('imageDimFields maps a sized rounded image to form-facing values (no theme/playback)', () => {
  const img = { dimMode: 'width', dimValue: 300, rounded: true };
  assert.deepEqual(imageDimFields(img), { dimMode: 'width', dimValue: '300', captureCorner: 'enabled' });
});

test('imageDimFields of an auto/default image', () => {
  assert.deepEqual(imageDimFields({ dimMode: 'none', dimValue: null }), { dimMode: 'none', dimValue: '', captureCorner: 'disabled' });
});

test('an image round-trips through buildComponentBody / parseComponents', () => {
  const img = { uuid: 'IMG-1', filename: 'media/buttons/menu-icon.png', dimMode: 'height', dimValue: 50, rounded: false };
  const body = buildComponentBody(null, 'Desc', [{ kind: 'image', img }]);
  const got = parseComponents(body, ADM_RE).components.find(c => c.kind === 'image')?.img;
  assert.deepEqual(got, img);
});

test('an image interleaves with a capture and an admonition in document order', () => {
  const cap = { uuid: 'CAP-1', lightFilename: 'a-light-mode.png', darkFilename: 'a-dark-mode.png', dimMode: 'none', dimValue: null, inversed: false, rounded: false };
  const adm = { prefix: '!!!', type: 'note', title: 'Note', body: 'text', uuid: null };
  const img = { uuid: 'IMG-1', filename: 'media/buttons/b.svg', dimMode: 'none', dimValue: null, rounded: false };
  const body = buildComponentBody(null, '', [{ kind: 'capture', cap }, { kind: 'image', img }, { kind: 'admonition', adm }]);
  const kinds = parseComponents(body, ADM_RE).components.map(c => c.kind);
  assert.deepEqual(kinds, ['capture', 'image', 'admonition']);
});

test('uuidOfComponent returns an image uuid', () => {
  assert.equal(uuidOfComponent({ kind: 'image', img: { uuid: 'IMG-9' } }), 'IMG-9');
});

test('componentMarkdown strips the identity span from the copy payload', () => {
  const img = { uuid: 'IMG-1', filename: 'media/buttons/x.png', dimMode: 'height', dimValue: 50, rounded: false };
  assert.equal(componentMarkdown({ kind: 'image', img }),
    '![](../assets/media/buttons/x.png){ style="height: 50px" loading=lazy }');
});

test('parsePastedComponents accepts a pasted image line and mints a fresh uuid', () => {
  const { components, error } = parsePastedComponents('![](../assets/media/buttons/x.png){ width="300" loading=lazy }');
  assert.equal(error, null);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'image');
  assert.ok(components[0].img.uuid);
  assert.equal(components[0].img.dimValue, 300);
});

console.log(`imageComponent: ${passed} passed`);
