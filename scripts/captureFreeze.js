/**
 * captureFreeze.js — a library capture picked into a system update becomes a
 * frozen copy.
 *
 * System updates never reference the shared guide library: a later recapture
 * there would rewrite what an update shows. A pair picked from any other
 * folder is copied (both files, plus its manifest entry) into
 * media/system-update-captures/ under a fresh short id (captureDest.js), and
 * the copy is what the update uses. A pair already in the frozen folder is
 * used as it is.
 *
 * Free of the Knowledge Base forms (form.js, captures.js): the in-page editor
 * on support.opus-safety.co.uk calls this the moment a capture is picked.
 */

import { githubPushImageIfNotExists } from './github.js';
import { readCaptureMeta, writeCaptureMeta } from './captureMeta.js';
import { readRepoDataUrl } from './repoClient.js';
import { isSystemUpdateCapturePath, shortId, toSystemUpdatePair } from './captureDest.js';

const ASSETS = 'docs/assets/';
const b64 = dataUrl => dataUrl.split(',')[1];

/** True when a library pick ({ light, dark } repo paths) has to be copied before a system update may use it. */
export function needsFreezing(pick) {
  return !!pick?.light && !isSystemUpdateCapturePath(pick.light);
}

/**
 * The pick a system update uses for a library pick: itself when it is already
 * frozen, otherwise a new copy in the frozen folder (pushed before this
 * resolves). Same shape in and out: { light, dark } repo paths.
 */
export async function freezeCapturePick(pick, onProgress) {
  if (!needsFreezing(pick)) return pick;
  const srcLight = pick.light;
  const srcDark = pick.dark || srcLight.replace('-light-mode', '-dark-mode');
  const [lightDataUrl, darkDataUrl, manifest] = await Promise.all([
    readRepoDataUrl(srcLight),
    readRepoDataUrl(srcDark),
    readCaptureMeta(),
  ]);
  const pair = toSystemUpdatePair(srcLight.replace(ASSETS, ''), srcDark.replace(ASSETS, ''), shortId());
  const light = ASSETS + pair.lightFilename;
  const dark = ASSETS + pair.darkFilename;
  await githubPushImageIfNotExists(light, b64(lightDataUrl), onProgress);
  await githubPushImageIfNotExists(dark, b64(darkDataUrl), onProgress);
  const meta = manifest[srcLight] ?? {};
  await writeCaptureMeta([{
    lightPath: light,
    resized: !!meta.resized,
    padding: meta.padding || 0,
    annotated: !!meta.annotated,
    zapped: !!meta.zapped,
  }], onProgress);
  return { ...pick, light, dark };
}
