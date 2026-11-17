import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tocTree, tocHtml } from '../scripts/kbToc.js';
import { renderGuidePage } from '../scripts/kbPageRender.js';

const h = (level, text, id = text.toLowerCase().replace(/\s+/g, '-'), uuid = id) => ({ level, text, id, uuid });

test('the title is left out; deeper headings nest under the one above', () => {
  const tree = tocTree([h(1, 'Page'), h(2, 'A'), h(3, 'A one'), h(3, 'A two'), h(2, 'B'), h(4, 'B deep')]);
  assert.deepEqual(tree.map(i => i.text), ['A', 'B']);
  assert.deepEqual(tree[0].children.map(i => i.text), ['A one', 'A two']);
  assert.deepEqual(tree[1].children.map(i => i.text), ['B deep']); // a skipped level nests under the nearest above
});

test('a page with only its title has no list', () => {
  assert.deepEqual(tocTree([h(1, 'Page')]), []);
});

test('tocHtml draws the theme markup, escaped', () => {
  const html = tocHtml(tocTree([h(2, 'Q & <A>', 'qa', 'u1'), h(3, 'Sub', 'sub', 'u2')]));
  assert.equal(html, '<li class="md-nav__item"><a href="#qa" class="md-nav__link" data-mb-toc="u1"><span class="md-ellipsis"><span class="md-typeset">Q &amp; &lt;A&gt;</span></span></a>'
    + '<nav class="md-nav" aria-label="Q &amp; &lt;A&gt;"><ul class="md-nav__list"><li class="md-nav__item"><a href="#sub" class="md-nav__link" data-mb-toc="u2"><span class="md-ellipsis"><span class="md-typeset">Sub</span></span></a></li></ul></nav></li>');
});

test('headings of one name get the site\'s distinct ids', () => {
  const span = id => `<span data-uuid="${id}" style="display:none"></span>`;
  const md = ['# Page', span('h1'), '', '## New section', span('s1'), '', '## New section', span('s2')].join('\n');
  const { html } = renderGuidePage(md);
  assert.match(html, /<h2 id="new-section" data-mb-node="s1"/);
  assert.match(html, /<h2 id="new-section_1" data-mb-node="s2"/);
});
