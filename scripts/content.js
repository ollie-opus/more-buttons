// Memoised actions.js import. Also publishes the module on the global that
// scripts/form.js reads. actions.js pulls in the whole editor stack, so nothing
// on the hot path (page load, navigation) may call this: only a click, a
// matched automation, or a capture session that needs restoring.
const getActions = () => (window.__mbActionsPromise ??=
    import(chrome.runtime.getURL('scripts/actions.js')).then(m => (window.__mbActionsModule = m, m)));

// Mirrors captureMode.js SESSION_KEY (pinned by tests/contentScript.test.mjs).
// Read here so a page with no capture session never pays the actions import.
const CAPTURE_SESSION_KEY = 'moreButtonsCaptureSession';

function dispatch(action) {
    getActions().then(module => {
        const [name, ...params] = action.split(':');
        const fn = module[name];
        if (typeof fn === 'function') fn(...params);
        else console.warn(`MB Warn: Action "${name}" not found in actions.js`);
    }).catch(err => console.error('MB Error: action failed', action, err));
}

//
// check if extension is active
//
chrome.storage.local.get("moreButtonsActive", (data) => {
    if (data.moreButtonsActive === false) {
        console.log("MB Log: Extension is deactivated. Please activate to run the extension");
        return;
    }

    //
    // ONE-TIME SETUP: modules, configs and compiled matchers. Loaded once per
    // document; every navigation after that is a handful of substring tests.
    //
    const setup = (async () => {
        const [
            { renderPageDock, removePageDock },
            { splitBySurface },
            { runAutomations },
            { compilePageMatch },
            { createNavigationWatcher },
            { watchIconSpans, loadChromeIcons },
            buttons,
            automations,
        ] = await Promise.all([
            import(chrome.runtime.getURL('scripts/pageDock.js')),
            import(chrome.runtime.getURL('scripts/dockLayout.js')),
            import(chrome.runtime.getURL('scripts/automations.js')),
            import(chrome.runtime.getURL('scripts/utils.js')),
            import(chrome.runtime.getURL('scripts/pageNavigation.js')),
            import(chrome.runtime.getURL('scripts/lucideIcons.js')),
            fetch(chrome.runtime.getURL("config/buttons.json")).then(r => r.json()),
            fetch(chrome.runtime.getURL("config/automations.json")).then(r => r.json()),
        ]);

        // Only page-surface buttons can ever render here; popup-only ones are
        // dropped before compiling so they aren't tested on every navigation.
        const { page } = splitBySurface(buttons);
        const pageButtons = page.map(def => ({ def, matches: compilePageMatch(def.pageMatch) }));
        const pageAutomations = automations.map(def => ({ def, matches: compilePageMatch(def.pageMatch) }));

        return { renderPageDock, removePageDock, runAutomations, createNavigationWatcher, watchIconSpans, loadChromeIcons, pageButtons, pageAutomations };
    })();

    //
    // PAGE DETECTION
    //
    // The dock is url-only work, so it is rebuilt the moment the url changes
    // (before the new page has rendered). Automations touch the page, so they
    // wait for the render to settle. See scripts/pageNavigation.js.
    //
    setup.then(({ renderPageDock, removePageDock, runAutomations, createNavigationWatcher, watchIconSpans, loadChromeIcons, pageButtons, pageAutomations }) => {
        const onNavigate = (url) => {
            const matched = pageButtons.filter(b => b.matches(url)).map(b => b.def);
            if (!matched.length) { removePageDock(); return; }
            console.log(`MB Log: ${matched.length} button(s) match, rendering dock`);
            // Icons are lucide names written as span text; the per-document painter
            // (idempotent) swaps them for inline SVG as the dock lands. The dock holds
            // its first reveal until the icon bodies have loaded.
            watchIconSpans(document);
            renderPageDock(matched, dispatch, { iconsReady: loadChromeIcons() })
                .catch(err => console.error("MB Error: Failed to render page dock", err));
        };

        const onSettle = (url) => {
            const matched = pageAutomations.filter(a => a.matches(url)).map(a => a.def);
            if (!matched.length) return;
            console.log(`MB Log: page settled, running ${matched.length} automation(s)`);
            watchIconSpans(document);
            runAutomations(matched, dispatch);
        };

        createNavigationWatcher({ doc: document, win: window, onNavigate, onSettle }).start();
    }).catch(err => console.error("MB Error: Failed to load UI configs", err));

    // Resume capture mode if a window.sessionStorage record survived a hard
    // navigation. restoreCaptureMode itself decides whether to restore based
    // on performance navigation type (reload → clear instead of restore).
    // Gated on the record existing so the ordinary page view never imports
    // the actions graph just to find there is nothing to restore.
    let hasCaptureSession = false;
    try { hasCaptureSession = window.sessionStorage.getItem(CAPTURE_SESSION_KEY) != null; } catch {}
    if (hasCaptureSession) {
        getActions().then(m => {
            m.restoreCaptureMode?.();
        }).catch(() => {});
    }

    // Actions recorder / player sessions (scripts/actionRecorder.js RECORDING_KEY,
    // scripts/actionPlayer.js PLAYBACK_KEY; pinned by tests/contentScript.test.mjs).
    // Unlike capture mode, a reload CONTINUES the session: a recording may span
    // a full page load and a playback resumes on the page it navigated to.
    const ACTION_SESSION_KEYS = ['moreButtonsActionRecording', 'moreButtonsActionPlayback'];
    let hasActionSession = false;
    try { hasActionSession = ACTION_SESSION_KEYS.some(k => window.sessionStorage.getItem(k) != null); } catch {}
    if (hasActionSession) {
        getActions().then(m => m.resumeActionSession?.()).catch(() => {});
    }

});

// Listen for action requests from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "runAction") return;
    const { actionName, params } = message;
    getActions().then(module => {
        const fn = module[actionName];
        if (typeof fn === "function") fn(...(params ?? []));
        sendResponse({ ok: true });
    });
    return true;
});
