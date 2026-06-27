// scripts/kbReorder.js
// Working-copy controller for KB tree reordering. Holds an editable merged
// nav-node tree, applies index-path move/reparent ops, tracks dirty state, and
// builds the { nav, draftNav } payload by projecting the edited tree onto each
// array's membership (exact values reused; Home/System and non-guide entries
// preserved). Pure — no DOM, no network.
import {
  slugify, valueMapByBase, leafBases, projectTree, spliceGuideBlock,
  nodeAtPath, moveSibling, detachAtPath, attachUnderPath, attachUnderSegments,
} from './navToml.js';

const parsePath = (s) => String(s).split('.').filter(x => x !== '').map(Number);

// True if `node` is `ancestor` itself or anywhere in its subtree.
function subtreeContains(ancestor, node) {
  if (ancestor === node) return true;
  if (!ancestor.children) return false;
  return ancestor.children.some(c => subtreeContains(c, node));
}

export function createReorderState({ tree, navItems, draftItems }) {
  let dirty = false;
  const liveMap = valueMapByBase(navItems);
  const draftMap = valueMapByBase(draftItems);

  const move = (pathStr, dir) => {
    if (moveSibling(tree, parsePath(pathStr), dir === 'up' ? -1 : +1)) dirty = true;
  };

  const moveToPath = (pathStr, targetIdxPathStr) => {
    // Resolve the target section to a NODE REFERENCE before detaching: detach
    // splices the source out, which shifts the index-path of any section that
    // follows it at a shared level — re-walking the stale index path would then
    // miss (dropping the node) or hit the wrong folder. A direct reference is
    // stable across the splice.
    const srcNode = nodeAtPath(tree, parsePath(pathStr));
    if (!srcNode) return;
    const targetIdx = targetIdxPathStr ? parsePath(targetIdxPathStr) : null;
    const targetNode = targetIdx ? nodeAtPath(tree, targetIdx) : null;
    if (targetIdx && (!targetNode || !targetNode.children)) return; // invalid target → no-op
    // Reject moving a folder into itself or its own descendant (would orphan
    // the subtree / create a cycle). The picker already excludes the exact
    // source path, but not its descendants.
    if (targetNode && subtreeContains(srcNode, targetNode)) return;
    const node = detachAtPath(tree, parsePath(pathStr));
    if (!node) return;
    if (targetNode) targetNode.children.push(node);
    else attachUnderPath(tree, null, node); // top level
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
    // Every guide filename in the edited tree, so spliceGuideBlock can recognise a
    // root-level leaf guide (a draft created with no path) as managed and not leave
    // a duplicate behind when it's reparented.
    const editedBases = leafBases(tree);
    const nav = spliceGuideBlock(navItems, projectTree(tree, liveMap), editedTopSlugs, editedBases);
    const draftNav = spliceGuideBlock(draftItems, projectTree(tree, draftMap), editedTopSlugs, editedBases);
    return { nav, draftNav };
  };

  return {
    getTree: () => tree,
    isDirty: () => dirty,
    move, moveToPath, moveToSegments, sectionTargets, buildPayload,
  };
}
