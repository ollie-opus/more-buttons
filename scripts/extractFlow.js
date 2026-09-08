/**
 * The captureExtractTheme orchestration, extracted from the service worker so
 * the message/CDP ordering is testable (tests/extractFlowOrder.test.mjs —
 * same pattern as captureFlow.js). background.js supplies `deps` built from
 * chrome.*; everything here is ordering, not I/O.
 *
 * Extract mode takes no screenshot — it flips prefers-color-scheme so the
 * content script can read COMPUTED styles under each theme and bake them into
 * the serialized SVG (svgExtract.js). The order is load-bearing:
 *
 *   emulate media → themeDelay sleep → serialize → reset emulation
 *
 * - The sleep must precede the serialize: JS-driven theme swaps repaint (and
 *   re-resolve CSS custom properties) asynchronously after the media flip, so
 *   reading computed colours immediately would bake the OLD theme's ink —
 *   the same failure the screenshot pipeline's post-rect settle prevents.
 * - Emulation lifetime is SW-owned: a content-side serialize failure cannot
 *   leak a stuck theme, because the catch path still resets and detaches.
 *
 * @param deps {{
 *   cmd: (method, params?) => Promise<any>,   // CDP command, tabId bound
 *   attach: () => Promise<void>,
 *   detach: () => Promise<void>,
 *   resetEmulation: () => Promise<void>,      // never rejects
 *   serialize: () => Promise<object>,         // content-script serialize round trip
 *   sleep: (ms) => Promise<void>,
 *   sessionHeld: boolean,                     // capture-mode session already attached
 * }}
 * @returns {Promise<{} | {error}>} the captureExtractTheme response payload
 */
export async function runExtractTheme(deps, msg) {
  const { forcedTheme, themeDelay = 0 } = msg;
  const { cmd, attach, detach, resetEmulation, serialize, sleep, sessionHeld } = deps;
  try {
    if (!sessionHeld) await attach();

    // Reduced motion rides along like every capture shot: the pick happened
    // by hover + shift-click, so hover-lift rules must stay parked while the
    // element is measured/serialized.
    const features = [{ name: 'prefers-reduced-motion', value: 'reduce' }];
    if (forcedTheme) features.push({ name: 'prefers-color-scheme', value: forcedTheme });
    await cmd('Emulation.setEmulatedMedia', { features });

    if (forcedTheme && themeDelay > 0) await sleep(themeDelay);

    const result = await serialize();
    if (result?.error) throw new Error(result.error);

    await resetEmulation();
    await detach();
    return {};
  } catch (err) {
    await resetEmulation().catch(() => {});
    try { await detach(); } catch {}
    return { error: err.message || 'Extract failed' };
  }
}
