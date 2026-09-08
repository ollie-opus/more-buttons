import { computeCaptureClip } from './captureGeometry.js';

/**
 * The captureTab orchestration, extracted from the service worker so the
 * message/CDP ordering is testable (tests/captureFlowOrder.test.mjs — same
 * pattern as planColdExit / captureColdExit). background.js supplies `deps`
 * built from chrome.*; everything here is ordering, not I/O.
 *
 * The order is load-bearing:
 *   emulate media → rect read → themeDelay sleep → bg sample → screenshot
 *
 * - The rect read must follow the media flip IMMEDIATELY: the theme flip
 *   triggers popover close-fades, and the content script's rect handler pins
 *   them open (neutralizeLayers) — sleeping first would let them fade out.
 * - The sleep must follow the rect read: the rect handler de-promotes GPU
 *   layers, and the async full-res re-raster needs the delay to commit before
 *   Page.captureScreenshot (intermittent blank popovers otherwise).
 * - The background sample must follow the sleep: sampling at rect time reads
 *   the pre-flip theme's colours — the padding band came out white on every
 *   dark-mode capture because the page was still painting light when sampled.
 *
 * @param deps {{
 *   cmd: (method, params?) => Promise<any>,        // CDP command, tabId bound
 *   attach: () => Promise<void>,
 *   detach: () => Promise<void>,
 *   resetEmulation: () => Promise<void>,           // never rejects
 *   getRect: () => Promise<object>,                // content-script rect read
 *   sampleBg: () => Promise<void>,                 // content-script bg sample, best-effort
 *   getZoom: () => Promise<number>,
 *   sleep: (ms) => Promise<void>,
 *   sessionHeld: boolean,                          // capture-mode session already attached
 * }}
 * @returns {Promise<{dataUrl, cropDip} | {error}>} the captureTab response payload
 */
export async function runCaptureTab(deps, msg) {
  const { scale, devicePixelRatio = 1, forcedTheme, themeDelay = 0, tight = false, wantBgSample = false } = msg;
  const { cmd, attach, detach, resetEmulation, getRect, sampleBg, getZoom, sleep, sessionHeld } = deps;
  try {
    if (!sessionHeld) await attach();

    // Emulate prefers-reduced-motion for every shot: the user picks the
    // element by hovering + shift-clicking, so :hover motion (lift
    // transforms/translates) is live at pick time and can snap on or off
    // between the rect read and Page.captureScreenshot — pixels shift
    // while the clip stays put. Sites that gate that motion behind
    // @media (prefers-reduced-motion: no-preference) simply have no lift
    // rule while `reduce` is emulated, regardless of mouse or hover state.
    // Also settles enter/exit animations generally. Applied before the
    // rect read so any snap it causes is ridden out by the content
    // script's waitForStable before measurement.
    const features = [{ name: 'prefers-reduced-motion', value: 'reduce' }];
    if (forcedTheme) features.push({ name: 'prefers-color-scheme', value: forcedTheme });
    await cmd('Emulation.setEmulatedMedia', { features });

    // Get the element rect from the content script (same coordinate space as
    // getBoundingClientRect). We avoid captureBeyondViewport because it uses the
    // layout viewport coordinate space, which excludes the scrollbar width and
    // causes a ~15px offset vs JS's visual viewport.
    //
    // The content script de-promotes the target popover's GPU layer (transform:none)
    // inside this getRectForCapture handler, forcing an async full-res inline
    // re-raster. The themeDelay wait below runs AFTER this rect read — i.e. after
    // de-promotion — so the re-raster has time to commit before Page.captureScreenshot;
    // otherwise the popover can be dropped from the frame (intermittent blank).
    const rect = await getRect();

    // Theme settle + de-promotion re-raster settle (see note above). Forced-theme
    // only; non-theme captures pass themeDelay=0. The de-promoted state persists on
    // the page until the content script restores it after this capture returns.
    if (forcedTheme && themeDelay > 0) await sleep(themeDelay);

    // Sample the padding background AFTER the settle, so the padding colour
    // matches the settled pixels the screenshot is about to capture. The
    // content script stores the sample in its own closure; nothing travels
    // back through the SW. Best-effort: on failure the content script keeps
    // sampledBgColor null and pads with nothing rather than a wrong colour.
    // With themeDelay=0 this runs right after the rect read — the user opted
    // out of settling, so that is today's timing by choice.
    if (wantBgSample) await sampleBg();

    // CDP clip coords are in CSS pixels at zoom=1. When the browser is zoomed,
    // getBoundingClientRect() still returns logical CSS pixels, so
    // computeCaptureClip multiplies by the current tab zoom to convert to
    // the coordinate space CDP expects. All grid-alignment subtleties
    // (integer clip.scale, device-pixel snapping, the cropped-off margin)
    // live in captureGeometry.js.
    const zoom = await getZoom();
    const { clip, clipScale, cropDip } = computeCaptureClip({ rect, zoom, devicePixelRatio, scale, tight });

    const result = await cmd('Page.captureScreenshot', {
      format: 'png',
      clip: { ...clip, scale: clipScale },
    });

    await resetEmulation();
    await detach();
    // cropDip (element box in DIP relative to the clip) rather than bitmap
    // pixels: how many px one DIP became depends on the display's
    // deviceScaleFactor, which the content script measures from the bitmap.
    return { dataUrl: 'data:image/png;base64,' + result.data, cropDip };
  } catch (err) {
    await resetEmulation().catch(() => {});
    try { await detach(); } catch {}
    return { error: err.message || 'Capture failed' };
  }
}
