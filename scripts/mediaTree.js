/**
 * mediaTree.js — Pure tree-builder for the media library (images + videos).
 *
 * Turns a flat list of repo blob paths into hierarchical folder/file nodes.
 * Light/dark pairs (-light-mode.<ext> / -dark-mode.<ext>) collapse to one leaf;
 * files with neither suffix become single leaves. Kept DOM-free so it can be
 * unit-tested and shared by the (DOM-bound) capture library.
 */

/**
 * @param {string[]} blobPaths - repo paths (already filtered to the media root).
 * @param {{root:string, exts:string[]}} cfg
 * @returns {Array<{kind:'folder',label:string,children:Array}|{kind:'file',label:string,attrs:object}>}
 */
export function buildMediaNodes(blobPaths, { root, exts }) {
  const extRe = new RegExp(`\\.(${exts.join('|')})$`, 'i');
  const lightRe = new RegExp(`-light-mode\\.(${exts.join('|')})$`, 'i');
  const darkRe = new RegExp(`-dark-mode\\.(${exts.join('|')})$`, 'i');

  const makeDir = () => ({ folders: new Map(), entries: new Map() });
  const tree = makeDir();

  for (const path of blobPaths) {
    if (!path.startsWith(root + '/') || !extRe.test(path)) continue;
    const relative = path.slice(root.length + 1);
    const parts = relative.split('/');
    const fileName = parts.pop();
    let cursor = tree;
    for (const part of parts) {
      if (!cursor.folders.has(part)) cursor.folders.set(part, makeDir());
      cursor = cursor.folders.get(part);
    }

    let baseId, variant;
    if (lightRe.test(fileName)) { baseId = fileName.replace(lightRe, ''); variant = 'light'; }
    else if (darkRe.test(fileName)) { baseId = fileName.replace(darkRe, ''); variant = 'dark'; }
    else { baseId = fileName; variant = 'single'; }

    if (!cursor.entries.has(baseId)) cursor.entries.set(baseId, { baseId });
    const entry = cursor.entries.get(baseId);
    if (variant === 'light') entry.light = path;
    else if (variant === 'dark') entry.dark = path;
    else entry.single = path;
  }

  function dirToNodes(dir) {
    const out = [];
    [...dir.folders.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([name, sub]) => {
      out.push({ kind: 'folder', label: name, children: dirToNodes(sub) });
    });
    [...dir.entries.values()].sort((a, b) => a.baseId.localeCompare(b.baseId)).forEach(entry => {
      // A single file's leaf label drops the file extension for readability.
      const label = entry.single ? entry.baseId.replace(/\.[a-z0-9]+$/i, '') : entry.baseId;
      out.push({
        kind: 'file',
        label,
        attrs: {
          'data-media-base': label,
          'data-media-light': entry.light ?? '',
          'data-media-dark': entry.dark ?? '',
          'data-media-single': entry.single ?? '',
        },
      });
    });
    return out;
  }

  return dirToNodes(tree);
}
