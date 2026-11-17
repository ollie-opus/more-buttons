import assert from 'node:assert/strict';
import { renderGuidePage, pageChromeHtml, renderTextHtml, renderInlineHtml, assetPathOf, safeUrl, TEXT_KIND, EMPTY_TEXT } from '../scripts/kbPageRender.js';
import { guideNodeIndex } from '../scripts/guideSideSwitch.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = id => `<span data-uuid="${id}" style="display:none"></span>`;
const assetUrl = src => { const a = assetPathOf(src); return a ? `/${a.path}${a.suffix}` : src; };
const render = md => renderGuidePage(md, { assetUrl });

const PAGE = [
  '---',
  'icon: lucide/user-plus',
  'tags:',
  '  - Managing OCC',
  '---',
  '',
  '# Adding a new employee',
  span('h1'),
  '',
  'Intro with **bold** and a [link](overview.md).',
  '',
  'Second paragraph',
  'on two lines.',
  '',
  '## Creating the record',
  span('s1'),
  '',
  '!!! step',
  '',
  `    ${span('a1')}`,
  '    Click **Pick workspace**.',
  '',
  `    ${span('c1')}`,
  '    ![](../assets/media/occ-captures/pick-light-mode.png#only-light){ style="height: 50px" loading=lazy }',
  '    ![](../assets/media/occ-captures/pick-dark-mode.png#only-dark){ style="height: 50px" loading=lazy }',
  '',
  '    !!! note "Heads up<span class="meta">(optional)</span>"',
  '',
  `        ${span('a2')}`,
  '        Nested note.',
  '',
  '??? tip "Fold me"',
  '',
  `    ${span('a3')}`,
  '    Hidden tip.',
  '',
  span('t1'),
  '=== "Single Site"',
  '',
  `    ${span('tab1')}`,
  '',
  '    First tab text.',
  '',
  `    ${span('v1')}`,
  '    <video src="../assets/media/videos/a.mp4" autoplay loop muted playsinline preload="none" style="border-radius: 8px"></video>',
  '',
  '=== "Multiple Sites"',
  '',
  `    ${span('tab2')}`,
  '',
  '    Second tab text.',
  '',
  '### Statuses',
  span('s2'),
  '',
  '- one',
  '- two',
  '',
  span('tb1'),
  '| Status | Description |',
  '| :--- | :---: |',
  '| <span class="mb-label mb-label-amber">In-progress</span> | Being **created**. |',
  '',
  span('b1'),
  '[Go :lucide-arrow-right:](overview.md){ .md-button .md-button--primary onclick="alert(1)" }',
  '',
  span('d1'),
  '```mermaid',
  'graph TD',
  '  A-->B',
  '```',
  '',
].join('\n');

const { html, title } = render(PAGE);

test('the H1 gives the page title; frontmatter is not drawn', () => {
  assert.equal(title, 'Adding a new employee');
  assert.ok(!html.includes('lucide/user-plus'));
  assert.ok(!html.includes('Managing OCC'));
});

test('sections render as their heading level, addressed by uuid', () => {
  assert.match(html, /<h1 id="adding-a-new-employee" data-mb-node="h1" data-mb-kind="section">Adding a new employee<\/h1>/);
  assert.match(html, /<h2 [^>]*data-mb-node="s1"[^>]*>Creating the record<\/h2>/);
  assert.match(html, /<h3 [^>]*data-mb-node="s2"[^>]*>Statuses<\/h3>/);
});

test('no identity span leaks into the page', () => {
  assert.ok(!html.includes('data-uuid'));
});

test('a container\'s text is one editable block of real paragraphs', () => {
  assert.match(html, new RegExp(`<div class="mb-kb-leaf" data-mb-node="[0-9a-f-]{36}" data-mb-kind="leaf" data-mb-comp="text"><div class="mb-kb-text" data-mb-text="block" data-mb-uuid="[0-9a-f-]{36}"><p>Intro with <strong>bold</strong> and a <a href="overview.md">link</a>.</p>\\n<p>Second paragraph on two lines.</p></div></div>`));
});

test('a container with no text gets nothing standing in for it', () => {
  assert.ok(!html.includes('--empty'));
  assert.ok(!html.includes('data-mb-at='));
});

test('an empty text block is drawn as an empty block of its own', () => {
  const out = renderGuidePage(['# T', '<span data-uuid="h1" style="display:none"></span>', '', '<span data-uuid="t1" style="display:none"></span>', EMPTY_TEXT].join('\n')).html;
  assert.match(out, /data-mb-node="t1" data-mb-kind="leaf" data-mb-comp="text"><div class="mb-kb-text --empty" data-mb-text="block" data-mb-uuid="t1"><\/div>/);
});

test('lists in text render as lists', () => {
  assert.match(html, /data-mb-text="block" data-mb-uuid="[0-9a-f-]{36}"><ul><li>one<\/li><li>two<\/li><\/ul><\/div>/);
});

test('a step with a meta holds the meta alone: the site writes "Step N" above it', () => {
  const md = `# T\n${span('h1')}\n\n!!! step "<span class="meta">(optional)</span>"\n\n    ${span('st')}\n    Do it.\n`;
  assert.match(render(md).html, /<p class="admonition-title" data-mb-title><span class="meta">\(optional\)<\/span><\/p>/);
});

test('admonitions use the theme markup, default their title to the type, and nest', () => {
  assert.match(html, /<div class="admonition step" data-mb-node="a1" data-mb-kind="admonition"><p class="admonition-title" data-mb-title>Step<\/p><div class="mb-kb-leaf" data-mb-node="[0-9a-f-]{36}" data-mb-kind="leaf" data-mb-comp="text"><div class="mb-kb-text" data-mb-text="block" data-mb-uuid="[0-9a-f-]{36}"><p>Click <strong>Pick workspace<\/strong>.<\/p><\/div>/);
  assert.match(html, /<div class="admonition note" data-mb-node="a2"[^>]*><p class="admonition-title" data-mb-title><span data-mb-edit="adm-title" data-mb-uuid="a2">Heads up<\/span><span class="meta">\(optional\)<\/span><\/p>/);
  // the nested note sits inside the step
  assert.ok(html.indexOf('data-mb-node="a2"') < html.indexOf('data-mb-node="a3"'));
  assert.ok(html.slice(html.indexOf('data-mb-node="a1"'), html.indexOf('data-mb-node="a3"')).includes('Nested note.'));
});

test('a closed collapsible admonition is a closed <details>', () => {
  assert.match(html, /<details class="tip" data-mb-node="a3" data-mb-kind="admonition" data-mb-fold="\?\?\?"><summary data-mb-title><span data-mb-edit="adm-title" data-mb-uuid="a3">Fold me<\/span><\/summary>/);
});

test('an open collapsible admonition (???+) is an open <details>', () => {
  const out = render(['# T', '<span data-uuid="h1" style="display:none"></span>', '', '???+ tip "Open me"', '', '    <span data-uuid="a9" style="display:none"></span>', '    Shown tip.'].join('\n')).html;
  assert.match(out, /<details class="tip" open data-mb-node="a9" data-mb-kind="admonition" data-mb-fold="\?\?\?\+">/);
});

test('captures render both theme images from the site root, attrs kept', () => {
  assert.match(html, /<div class="mb-kb-leaf" data-mb-node="c1" data-mb-kind="leaf" data-mb-comp="capture"><p><img alt="" src="\/assets\/media\/occ-captures\/pick-light-mode.png#only-light" style="height: 50px" loading="lazy">\n<img alt="" src="\/assets\/media\/occ-captures\/pick-dark-mode.png#only-dark" style="height: 50px" loading="lazy"><\/p><\/div>/);
});

test('content tabs use the theme\'s radio markup; each tab is its own text container', () => {
  assert.match(html, /<div class="tabbed-set tabbed-alternate" data-tabs="1:2" data-mb-node="t1" data-mb-kind="tabs"><input checked="checked" id="__mbtab_1_1" name="__mbtab_1" type="radio"><input id="__mbtab_1_2" name="__mbtab_1" type="radio"><div class="tabbed-labels"><label for="__mbtab_1_1" data-mb-edit="tab-title" data-mb-uuid="tab1">Single Site<\/label><label for="__mbtab_1_2" data-mb-edit="tab-title" data-mb-uuid="tab2">Multiple Sites<\/label><\/div>/);
  assert.match(html, /<div class="tabbed-block" data-mb-node="tab1" data-mb-kind="tab"><div class="mb-kb-leaf" data-mb-node="[0-9a-f-]{36}" data-mb-kind="leaf" data-mb-comp="text"><div class="mb-kb-text" data-mb-text="block" data-mb-uuid="[0-9a-f-]{36}"><p>First tab text.<\/p><\/div>/);
  assert.match(html, /data-mb-node="tab2" data-mb-kind="tab"><div class="mb-kb-leaf" data-mb-node="[0-9a-f-]{36}" data-mb-kind="leaf" data-mb-comp="text"><div class="mb-kb-text" data-mb-text="block" data-mb-uuid="[0-9a-f-]{36}"><p>Second tab text.<\/p>/);
});

test('videos keep their attributes with the src rewritten', () => {
  assert.match(html, /data-mb-node="v1" data-mb-kind="leaf" data-mb-comp="video"><p><video src="\/assets\/media\/videos\/a.mp4" autoplay loop muted playsinline preload="none" style="border-radius: 8px"><\/video><\/p>/);
});

test('data tables render aligned cells with inline markup and label pills', () => {
  assert.match(html, /data-mb-comp="table"><div class="md-typeset__scrollwrap"><div class="md-typeset__table"><table><thead><tr><th style="text-align: left" data-mb-edit="cell" data-mb-uuid="tb1" data-mb-row="-1" data-mb-col="0">Status<\/th><th style="text-align: center" data-mb-edit="cell" data-mb-uuid="tb1" data-mb-row="-1" data-mb-col="1">Description<\/th><\/tr><\/thead>/);
  assert.match(html, /<td style="text-align: left" data-mb-edit="cell" data-mb-uuid="tb1" data-mb-row="0" data-mb-col="0"><span class="mb-label mb-label-amber"[^>]*>In-progress<\/span><\/td><td style="text-align: center" data-mb-edit="cell" data-mb-uuid="tb1" data-mb-row="0" data-mb-col="1">Being <strong>created<\/strong>.<\/td>/);
});

test('buttons keep their classes and icon, and lose any onclick', () => {
  assert.match(html, /data-mb-comp="button"><p><a href="overview.md" class="md-button md-button--primary"><span data-mb-edit="btn-label" data-mb-uuid="b1">Go<\/span> <span class="mb-icon" data-mb-icon="arrow-right"[^>]*><\/span><\/a><\/p>/);
  assert.ok(!html.includes('onclick'));
  assert.ok(!html.includes('alert(1)'));
});

test('a diagram is a slot for the copy the site built, with its source under it to edit', () => {
  assert.match(html, /data-mb-comp="diagram"><div class="mb-kb-placeholder" data-mb-built-slot="d1">/);
  assert.match(html, /<pre class="mb-kb-source"><code data-mb-edit="diagram" data-mb-uuid="d1">graph TD\n  A--&gt;B<\/code><\/pre>/);
});

test('code blocks: drawn as the live page, markers as bubbles; a media cell is not editable', () => {
  const out = render([
    '# T', span('h'), '',
    span('cb'), '```python title="x.py" hl_lines="1"', 'print(1)  # (1)!', '```', '', '1. A **note**', '',
    span('tb'), '', '| A | B |', '| :--- | :--- |', '| ![](../assets/media/buttons/save.svg) | text |', '',
  ].join('\n')).html;
  assert.match(out, /<div class="highlight mb-kb-code language-python" data-mb-code="cb"><span class="filename">x\.py<\/span><pre data-mb-hl="1"><code data-mb-edit="code" data-mb-uuid="cb">print\(1\) <span class="md-annotation mb-kb-ann" contenteditable="false" data-mb-ann="0">/);
  assert.doesNotMatch(out, /mb-kb-annotations/, 'an annotation with a marker is in its bubble, not listed');
  const numbered = render(['# T', span('h'), '', span('n'), '```bash linenums="4"', 'a', 'b', '```', ''].join('\n')).html;
  assert.match(numbered, /<pre data-mb-hl="" data-mb-linenums="4"><span class="mb-kb-code-nums" aria-hidden="true">4\n5<\/span><code /);
  assert.match(out, /<td style="text-align: left"><img alt="" src="\/assets\/media\/buttons\/save\.svg"><\/td><td style="text-align: left" data-mb-edit="cell" data-mb-uuid="tb" data-mb-row="0" data-mb-col="1">text<\/td>/);
});

test('every rendered node is one the editors can address (same index as the form editor)', () => {
  const idx = guideNodeIndex(PAGE);
  // A container's leading text is its Description field on the form, not a node there.
  const rendered = [...html.matchAll(/data-mb-node="([^"]+)" data-mb-kind="([a-z]+)"(?! data-mb-comp="text")/g)].map(m => [m[1], m[2]]);
  assert.equal(rendered.length, idx.byUuid.size);
  for (const [uuid, kind] of rendered) {
    assert.equal(idx.byUuid.get(uuid)?.kind, kind, uuid);
  }
});

test('grids render their cells, with flavor, spill and vertical alignment', () => {
  const md = [
    '# T', span('h'), '',
    span('g1'),
    '',
    '<div class="grid" markdown>', '',
    '<div class="card spill" style="align-self: center" markdown>', '', span('cell1'), '', 'Hello', '', '</div>', '',
    '<div class="card" markdown>', '', span('cell2'), '', 'World', '', '</div>', '',
    '</div>', '',
  ].join('\n');
  const out = render(md).html;
  assert.match(out, /<div class="grid" data-mb-node="g1" data-mb-kind="grid"><div class="card spill" style="align-self: center" data-mb-node="cell1" data-mb-kind="cell"><div class="mb-kb-leaf" data-mb-node="[0-9a-f-]{36}" data-mb-kind="leaf" data-mb-comp="text"><div class="mb-kb-text" data-mb-text="block" data-mb-uuid="[0-9a-f-]{36}"><p>Hello<\/p><\/div><\/div><\/div><div class="card" data-mb-node="cell2" data-mb-kind="cell">/);
});

test('a hidden section title is flagged, not dropped', () => {
  const md = ['# T', span('h'), '', '## Quiet', span('q'),
    '<style data-mb-hide-section-title>:is(h1,h2,h3):has(+ p + style[data-mb-hide-section-title]){display:none}</style>', '', 'Body.', ''].join('\n');
  const out = render(md).html;
  assert.match(out, /<h2 [^>]*data-mb-node="q" data-mb-kind="section" data-mb-title-hidden>Quiet<\/h2>/);
  assert.match(out, /data-mb-text="block" data-mb-uuid="[0-9a-f-]{36}"><p>Body.<\/p>/);
  assert.ok(!out.includes('<style'));
});

test('text is escaped: markup typed into a description never becomes live HTML', () => {
  const out = render(['# T', span('h'), '', 'Use <script>alert(1)</script> & co.', ''].join('\n')).html;
  assert.ok(!out.includes('<script>'));
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; co\./);
});

test('only http(s), mailto, tel and relative urls survive', () => {
  for (const ok of ['https://a.b/c', 'http://a.b', 'mailto:x@y.z', 'tel:123', 'overview.md', '../assets/a.png#only-light', '/pages/x/', '#top', '']) {
    assert.equal(safeUrl(ok), ok, ok);
  }
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>', 'vbscript:x']) {
    assert.equal(safeUrl(bad), '#', bad);
  }
});

test('a tampered video line is not a video: it stays escaped text, and no handler or tag gets through', () => {
  const md = ['# T', span('h'), '', span('v'),
    '<video src="../assets/media/videos/a.mp4" autoplay loop muted playsinline preload="none" style="border-radius: 8px" onerror="alert(1)"></video><img/src=x/onerror=alert(3)>', ''].join('\n');
  const out = render(md).html;
  assert.ok(!/<(?:img|video|script)\b/i.test(out), out);
  assert.match(out, /&lt;video src=/);
});

test('a real video is rebuilt from an allowlist of attributes, in a fixed order', () => {
  const md = ['# T', span('h'), '', span('v'),
    '<video src="../assets/media/videos/a.mp4" autoplay loop muted playsinline preload="none" style="height: 200px"></video>', ''].join('\n');
  const out = render(md).html;
  assert.match(out, /data-mb-node="v" data-mb-kind="leaf" data-mb-comp="video"><p><video src="\/assets\/media\/videos\/a\.mp4" autoplay loop muted playsinline preload="none" style="height: 200px"><\/video><\/p>/);
});

test('links, button targets and image attributes cannot carry script', () => {
  const md = ['# T', span('h'), '', 'A [bad](javascript:evil) link and a [good](https://x.y/z) one.', '',
    span('b'), '[Go](javascript:evil){ .md-button href="javascript:evil2" onclick="evil3" target="_blank" }', '',
    span('i'), '![](../assets/media/images/x.png){ style="height: 80px; behavior: url(x)" onload="evil4" srcset="javascript:evil5" loading=lazy }', ''].join('\n');
  const out = render(md).html;
  assert.ok(!/javascript:|evil|onclick|onload|srcset|behavior/.test(out), out);
  assert.match(out, /A <a href="#">bad<\/a> link and a <a href="https:\/\/x\.y\/z">good<\/a> one\./);
  assert.match(out, /data-mb-comp="button"><p><a href="#" class="md-button"><span data-mb-edit="btn-label" data-mb-uuid="b">Go<\/span><\/a><\/p>/);
  assert.match(out, /<img alt="" src="\/assets\/media\/images\/x\.png" style="height: 80px" loading="lazy">/);
});

test('asset paths resolve from any depth; other urls are left alone', () => {
  assert.deepEqual(assetPathOf('../assets/media/a.png#only-light'), { path: 'assets/media/a.png', suffix: '#only-light' });
  assert.deepEqual(assetPathOf('../../assets/media/a.png'), { path: 'assets/media/a.png', suffix: '' });
  assert.equal(assetPathOf('https://example.com/a.png'), null);
  assert.equal(assetPathOf('assets/a.png'), null);
});

test('an empty or section-less file renders nothing rather than throwing', () => {
  assert.deepEqual(render(''), { html: '', title: '' });
  assert.equal(render('just text, no heading').html, '');
});

// ── Insert slots ────────────────────────────────────────────────

const slotsOf = html => [...html.matchAll(/<div class="mb-kb-insert" data-mb-insert-kind="([^"]*)" data-mb-insert-uuid="([^"]*)" data-mb-insert-at="(\d+)">/g)]
  .map(m => ({ kind: m[1], uuid: m[2], at: Number(m[3]) }));

test('no insert slots unless asked for', () => {
  assert.equal(slotsOf(render(PAGE).html).length, 0);
  assert.doesNotMatch(render(PAGE).html, /mb-kb-insert/);
});

test('with insert slots, every container gets one slot per block (text included) plus one after the last', () => {
  const { html } = renderGuidePage(PAGE, { assetUrl, insertSlots: true });
  const slots = slotsOf(html);
  assert.ok(slots.length > 0);
  const byContainer = new Map();
  for (const s of slots) {
    const key = `${s.kind}|${s.uuid}`;
    byContainer.set(key, [...(byContainer.get(key) ?? []), s.at]);
  }
  for (const [key, ats] of byContainer) {
    const [kind, uuid] = key.split('|');
    assert.ok(Object.values(TEXT_KIND).includes(kind), key);
    assert.ok(uuid, 'a slot always names its container');
    // 0..n in order: n components → n + 1 places to insert.
    assert.deepEqual(ats, ats.map((_, i) => i), key);
  }
  // The H1 section holds one block (its text): a slot above it and one below.
  assert.deepEqual(byContainer.get(`${TEXT_KIND.section}|h1`), [0, 1]);
  assert.ok(byContainer.has(`${TEXT_KIND.section}|s1`));
  assert.ok(byContainer.has(`${TEXT_KIND.admonition}|a1`));
});

test('insert slots do not change anything else on the page', () => {
  const withSlots = renderGuidePage(PAGE, { assetUrl, insertSlots: true }).html
    .replace(/<div class="mb-kb-insert"[^>]*><\/div>\n?/g, '')
    .replace(/<button type="button" class="mb-kb-(?:newtab|tabadd)".*?<\/button>/g, '');
  assert.equal(withSlots.replace(/\n/g, ''), render(PAGE).html.replace(/\n/g, ''));
});

test('a script link is defused in a list item as it is in a paragraph', () => {
  for (const md of ['[x](javascript:alert(1))', '- [x](javascript:alert(1))', '1. [x](JaVaScRiPt:alert(1))', '- a\n  - [x](data:text/html,hi)']) {
    const out = renderTextHtml(md, { assetUrl });
    assert.doesNotMatch(out, /href="(?:javascript|data):/i, md);
    assert.match(out, /href="#"/, md);
  }
  assert.match(renderTextHtml('- [ok](overview.md)', { assetUrl }), /href="overview\.md"/);
});

test('one block redraws on its own exactly as the page drew it', () => {
  const text = 'Intro with **bold** and a [link](overview.md).\n\nSecond paragraph\non two lines.';
  const block = renderTextHtml(text, { assetUrl });
  assert.ok(render(PAGE).html.includes(`">${block}</div></div>\n<h2`));
  assert.equal(renderTextHtml('', { assetUrl }), '');
  assert.equal(renderInlineHtml('Creating **the** record'), 'Creating <strong>the</strong> record');
});

test('tabs in the editor: a "New tab" ghost ends the label row; a tab has no Add card of its own', () => {
  const html = renderGuidePage(PAGE, { assetUrl, insertSlots: true }).html;
  assert.equal(html.split('data-mb-newtab="t1"').length - 1, 1);
  assert.match(html, /Multiple Sites<\/label><button type="button" class="mb-kb-newtab" data-mb-newtab="t1"><span class="mb-kb-newtab__plus" aria-hidden="true"><\/span><span>New tab<\/span><\/button><\/div>/);
  for (const tab of ['tab1', 'tab2']) {
    assert.match(html, new RegExp(`data-mb-insert-uuid="${tab}" data-mb-insert-at="\\d+"></div>\\s*</div>`));
  }
  assert.ok(!html.includes('mb-kb-tabadd'));
  // The read only view draws neither.
  const live = render(PAGE).html;
  assert.ok(!live.includes('mb-kb-newtab') && !live.includes('mb-kb-tabadd'));
});

console.log(`\n${passed} passed`);

// ── What the site draws from the frontmatter ─────────────────────────────────

const fm = (tags, hide = []) => `---\ntags:\n${tags.map(t => `  - ${t}`).join('\n')}\n${hide.length ? `hide:\n${hide.map(h => `  - ${h}`).join('\n')}\n` : ''}---\n\n# Page\n`;

test('pageChromeHtml: Written for shows the audience and every one above it, as the site builds it', () => {
  const { writtenFor } = pageChromeHtml(fm(['Managing OCC']));
  assert.equal(writtenFor, '<p class="mb-written-for"><span class="mb-written-for__label">Written for</span>'
    + '<span class="mb-label mb-label-purple"><span class="twemoji" data-mb-lucide="user-shield"></span>Managers</span>'
    + '<span class="mb-label mb-label-pink"><span class="twemoji" data-mb-lucide="user-cog"></span>Administrators</span></p>');
  assert.equal((pageChromeHtml(fm(['System', 'Using OCC'])).writtenFor.match(/mb-label /g) ?? []).length, 3);
});

test('pageChromeHtml: no Written for line with no audience tag, or when it is hidden', () => {
  assert.equal(pageChromeHtml(fm(['System'])).writtenFor, '');
  assert.equal(pageChromeHtml(fm(['Managing OCC'], ['written-for'])).writtenFor, '');
  assert.equal(pageChromeHtml('# Page\n').writtenFor, '');
});

test('pageChromeHtml: the site registry names, colours and orders the pills', () => {
  const audiences = [{ tag: 'Managing OCC', name: 'Bosses', colour: 'teal', icon: '' }, { tag: 'Using OCC', name: 'All <b>', colour: '', icon: 'lucide/user' }];
  assert.equal(pageChromeHtml(fm(['Managing OCC']), { audiences }).writtenFor,
    '<p class="mb-written-for"><span class="mb-written-for__label">Written for</span>'
    + '<span class="mb-label mb-label-teal">Bosses</span>'
    + '<span class="mb-label mb-label-grey"><span class="twemoji" data-mb-lucide="user"></span>All &lt;b&gt;</span></p>');
});

test('pageChromeHtml: the tags row carries every tag in frontmatter order, the audience tag too', () => {
  assert.equal(pageChromeHtml(fm(['Managing OCC', 'Overview', 'Add-on'], ['written-for'])).tags,
    '<nav class="md-tags"><span class="md-tag">Managing OCC</span><span class="md-tag">Overview</span><span class="md-tag">Add-on</span></nav>');
  assert.equal(pageChromeHtml('# Page\n').tags, '');
  assert.match(pageChromeHtml(fm(['A & B'], ['tags'])).tags, /^<nav class="md-tags" hidden><span class="md-tag">A &amp; B<\/span>/);
});
