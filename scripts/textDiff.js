// Pure redline engine for the edit log: token LCS diff with a line-level
// fallback, plus section- and item-scoped block builders keyed by UUID.
import { parseSections } from './sections.js';
import { parseAdmonitions, splitTitleMeta, stripLabelSpans, stripInlineAtoms } from './admonitions.js';

export const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid=/;

export function stripIdentityLines(text) {
  return text.split('\n').filter(l => !UUID_SPAN_LINE_RE.test(l)).join('\n');
}

function pushOp(ops, op, text) {
  if (!text) return;
  const last = ops[ops.length - 1];
  if (last && last.op === op) last.text += text;
  else ops.push({ op, text });
}

// LCS over two token arrays; returns merged ops. Callers keep n*m bounded.
function lcsOps(a, b) {
  const n = a.length, m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pushOp(ops, 'eq', a[i]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { pushOp(ops, 'del', a[i]); i++; }
    else { pushOp(ops, 'ins', b[j]); j++; }
  }
  while (i < n) pushOp(ops, 'del', a[i++]);
  while (j < m) pushOp(ops, 'ins', b[j++]);
  return ops;
}

// Diff two token arrays after trimming the common prefix/suffix, so the LCS
// table only covers the changed middle.
function diffTokens(a, b, cap) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const ops = [];
  pushOp(ops, 'eq', a.slice(0, s).join(''));
  const midA = a.slice(s, ea), midB = b.slice(s, eb);
  if (midA.length > cap || midB.length > cap) {
    pushOp(ops, 'del', midA.join(''));
    pushOp(ops, 'ins', midB.join(''));
  } else {
    for (const o of lcsOps(midA, midB)) pushOp(ops, o.op, o.text);
  }
  pushOp(ops, 'eq', a.slice(ea).join(''));
  return ops;
}

export function tokenDiff(a, b, { cap = 2000 } = {}) {
  if (a === b) return [{ op: 'eq', text: a }];
  const wordsA = a.match(/\s+|\w+|[^\s\w]/g) || [];
  const wordsB = b.match(/\s+|\w+|[^\s\w]/g) || [];
  if (wordsA.length <= cap && wordsB.length <= cap) return diffTokens(wordsA, wordsB, cap);
  const lineRe = /[^\n]*\n|[^\n]+/g;
  return diffTokens(a.match(lineRe) || [], b.match(lineRe) || [], cap);
}

function wholeFileBlocks(beforeMd, afterMd) {
  if (beforeMd === afterMd) return [];
  if (beforeMd === '') return [{ title: 'Whole page', status: 'added', ops: [{ op: 'ins', text: stripIdentityLines(afterMd) }] }];
  if (afterMd === '') return [{ title: 'Whole page', status: 'removed', ops: [{ op: 'del', text: stripIdentityLines(beforeMd) }] }];
  return [{ title: 'Whole page', status: 'changed', ops: tokenDiff(stripIdentityLines(beforeMd), stripIdentityLines(afterMd)) }];
}

function scopedBlocks(title, status, beforeText, afterText) {
  if (status === 'added') return { title, status, ops: [{ op: 'ins', text: afterText }] };
  if (status === 'removed') return { title, status, ops: [{ op: 'del', text: beforeText }] };
  return { title, status, ops: tokenDiff(beforeText, afterText) };
}

function sectionMap(md) {
  const lines = md.split('\n');
  const secs = parseSections(md);
  const preambleEnd = secs.length ? secs[0].headerLine : lines.length;
  const preamble = stripIdentityLines(lines.slice(0, preambleEnd).join('\n'));
  const map = new Map();
  for (const s of secs) {
    if (!s.uuid || map.has(s.uuid)) continue;
    map.set(s.uuid, { title: s.title, text: stripIdentityLines(lines.slice(s.headerLine, s.ownedEndLine).join('\n')) });
  }
  return { preamble, map };
}

export function sectionRedline(beforeMd, afterMd) {
  if (beforeMd === afterMd) return [];
  if (beforeMd === '' || afterMd === '') return wholeFileBlocks(beforeMd, afterMd);
  const b = sectionMap(beforeMd), a = sectionMap(afterMd);
  const blocks = [];
  if (b.preamble !== a.preamble) blocks.push(scopedBlocks('Page settings', 'changed', b.preamble, a.preamble));
  // Walk after-order; emit each removed section right after the nearest
  // preceding before-section that survives (or at the front if none).
  const beforeKeys = [...b.map.keys()];
  const removedAfter = new Map(); // anchor uuid|null -> removed uuids
  let anchor = null;
  for (const k of beforeKeys) {
    if (a.map.has(k)) anchor = k;
    else { if (!removedAfter.has(anchor)) removedAfter.set(anchor, []); removedAfter.get(anchor).push(k); }
  }
  const emitRemoved = key => {
    for (const k of removedAfter.get(key) || []) {
      const s = b.map.get(k);
      blocks.push(scopedBlocks(s.title, 'removed', s.text, ''));
    }
  };
  emitRemoved(null);
  for (const [k, s] of a.map) {
    const prev = b.map.get(k);
    if (!prev) blocks.push(scopedBlocks(s.title, 'added', '', s.text));
    else if (prev.text !== s.text) blocks.push(scopedBlocks(s.title, 'changed', prev.text, s.text));
    emitRemoved(k);
  }
  if (!blocks.length) {
    const order = sectionOrderBlock(b.map, a.map);
    if (order) return [order];
  }
  return blocks.length ? blocks : wholeFileBlocks(beforeMd, afterMd);
}

// Same sections, same text, different order: show the title lists, not a whole-file diff.
function sectionOrderBlock(bMap, aMap) {
  const bKeys = [...bMap.keys()], aKeys = [...aMap.keys()];
  if (bKeys.length !== aKeys.length || !bKeys.every(k => aMap.has(k))) return null;
  if (bKeys.every((k, i) => k === aKeys[i])) return null;
  if (!bKeys.every(k => bMap.get(k).text === aMap.get(k).text)) return null;
  const titles = (keys, map) => keys.map(k => map.get(k).title).join('\n') + '\n';
  return { title: 'Section order', status: 'changed', ops: [
    { op: 'del', text: titles(bKeys, bMap) },
    { op: 'ins', text: titles(aKeys, aMap) },
  ] };
}

function findItem(md, uuid, typeRegex) {
  const block = parseAdmonitions(md, typeRegex).find(x => x.uuid === uuid);
  if (!block) return null;
  const lines = md.split('\n');
  const title = stripInlineAtoms(stripLabelSpans(splitTitleMeta(block.title).title)) || block.type;
  return { title, text: stripIdentityLines(lines.slice(block.headerLine, block.endLine).join('\n')) };
}

export function itemRedline(beforeMd, afterMd, uuid, typeRegex) {
  const b = findItem(beforeMd, uuid, typeRegex), a = findItem(afterMd, uuid, typeRegex);
  if (!b && !a) return wholeFileBlocks(beforeMd, afterMd);
  if (b && a) return b.text === a.text ? [] : [scopedBlocks(a.title, 'changed', b.text, a.text)];
  if (a) return [scopedBlocks(a.title, 'added', '', a.text)];
  return [scopedBlocks(b.title, 'removed', b.text, '')];
}
