// scripts/kbReorder.js
// Working-copy controller for KB tree reordering. Holds an editable merged
// nav-node tree, applies index-path move/reparent ops, tracks dirty state, and
// builds the { nav, draftNav } payload by projecting the edited tree onto each
// array's membership (exact values reused; Home/System and non-guide entries
// preserved). Pure — no DOM, no network.
import {
  slugify, valueMapByBase, projectTree, spliceGuideBlock,
  nodeAtPath, moveSibling, detachAtPath, attachUnderPath, attachUnderSegments,
} from './navToml.js';

const parsePath = (s) => String(s).split('.').filter(x => x !== '').map(Number);

export function createReorderState({ tree, navItems, draftItems }) {
  let dirty = false;
  const liveMap = valueMapByBase(navItems);
  const draftMap = valueMapByBase(draftItems);

  const move = (pathStr, dir) => {
    if (moveSibling(tree, parsePath(pathStr), dir === 'up' ? -1 : +1)) dirty = true;
  };

  const moveToPath = (pathStr, targetIdxPathStr) => {
    const node = detachAtPath(tree, parsePath(pathStr));
    if (!node) return;
    const target = targetIdxPathStr ? parsePath(targetIdxPathStr) : null;
    attachUnderPath(tree, target, node);
    dirty = true;
  };

  const moveToSegments = (pathStr, segments) => {
    const node = detachAtPath(tree, parsePath(pathStr));
    if (!node) return;
    attachUnderSegments(tree, segments, node);
    dirty = true;
  };

  const sectionTargets = () => {
    const out = [];
    const walk = (level, idxTrail, labelTrail) => {
      level.forEach((n, i) => {
        if (!n.children) return;
        const idxPath = [...idxTrail, i];
        const label = [...labelTrail, n.name].join('/');
        out.push({ pathStr: idxPath.join('.'), label });
        walk(n.children, idxPath, [...labelTrail, n.name]);
      });
    };
    walk(tree, [], []);
    return out;
  };

  const buildPayload = () => {
    const editedTopSlugs = new Set(
      tree.filter(n => n.children).map(n => slugify(n.name))
    );
    const nav = spliceGuideBlock(navItems, projectTree(tree, liveMap), editedTopSlugs);
    const draftNav = spliceGuideBlock(draftItems, projectTree(tree, draftMap), editedTopSlugs);
    return { nav, draftNav };
  };

  return {
    getTree: () => tree,
    isDirty: () => dirty,
    move, moveToPath, moveToSegments, sectionTargets, buildPayload,
  };
}
