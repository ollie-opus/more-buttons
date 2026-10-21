// Memoised actions.js import. Also publishes the module on the global that
// scripts/form.js reads.
const getActions = () => (window.__mbActionsPromise ??=
    import(chrome.runtime.getURL('scripts/actions.js')).then(m => (window.__mbActionsModule = m, m)));

//
// check if extension is active
//
chrome.storage.local.get("moreButtonsActive", (data) => {
    if (data.moreButtonsActive === false) {
        console.log("MB Log: Extension is deactivated. Please activate to run the extension");
        return;
    }

    function injectGoogleMaterialIcons() {
        if (document.getElementById('google-material-icons-css')) return;

        const addLink = () => {
            const style = document.createElement('style');
            style.id = 'google-material-icons-css';
            // inline-block + width:1em + overflow:hidden reserves an
            // icon-sized slot so layout doesn't jump when the glyph arrives.
            style.textContent = `.material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-weight: normal; font-style: normal; font-size: 24px; line-height: 1; letter-spacing: normal; text-transform: none; white-space: nowrap; word-wrap: normal; direction: ltr; user-select: none; display: inline-block; width: 1em; overflow: hidden; vertical-align: middle; }`;
            document.head.appendChild(style);

            // Register the font via FontFace API using fetched bytes rather
            // than a chrome-extension:// URL in @font-face. The host page's
            // font-src CSP applies to URL-based @font-face loads but not to
            // byte-based FontFace registrations, so this works on any site.
            if (document.fonts?.add && !window.__mbMaterialFontLoading) {
                window.__mbMaterialFontLoading = true;
                fetch(chrome.runtime.getURL('assets/fonts/MaterialSymbolsOutlined.woff2'))
                    .then(r => r.arrayBuffer())
                    .then(buf => {
                        const face = new FontFace('Material Symbols Outlined', buf, {
                            style: 'normal',
                            weight: '100 700',
                            display: 'block',
                        });
                        return face.load().then(loaded => document.fonts.add(loaded));
                    })
                    .catch(() => {});
            }
        };

        if (document.head) {
            addLink();
        } else {
            const observer = new MutationObserver(() => {
                if (document.head) {
                    addLink();
                    observer.disconnect();
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
    }

    // Unified loader for the page dock + automations
    async function loadUI() {
        try {
            const [
                { renderPageDock, removePageDock },
                { splitBySurface },
                { runAutomations },
                { pageMatchesUrl },
            ] = await Promise.all([
                import(chrome.runtime.getURL('scripts/pageDock.js')),
                import(chrome.runtime.getURL('scripts/dockLayout.js')),
                import(chrome.runtime.getURL('scripts/automations.js')),
                import(chrome.runtime.getURL('scripts/utils.js')),
            ]);

            const [buttonsRes, automationsRes] = await Promise.all([
                fetch(chrome.runtime.getURL("config/buttons.json")),
                fetch(chrome.runtime.getURL("config/automations.json")),
            ]);

            const buttons = await buttonsRes.json();
            const automations = await automationsRes.json();

            const url = window.location.href;
            const matchedButtons = buttons.filter(btn => pageMatchesUrl(btn.pageMatch, url));
            const { page: pageButtons } = splitBySurface(matchedButtons);
            const matchedAutomations = automations.filter(auto => pageMatchesUrl(auto.pageMatch, url));

            // Clear any dock left over from a previous URL before bailing out.
            if (!pageButtons.length) removePageDock();

            if (!pageButtons.length && !matchedAutomations.length) return;

            console.log("MB Log: URL match detected. Rendering buttons / running automations...");
            injectGoogleMaterialIcons();

            const dispatch = (action) => {
                getActions().then(module => {
                    const [name, ...params] = action.split(':');
                    const fn = module[name];
                    if (typeof fn === 'function') fn(...params);
                    else console.warn(`MB Warn: Action "${name}" not found in actions.js`);
                });
            };

            runAutomations(matchedAutomations, dispatch);

            if (pageButtons.length) await renderPageDock(pageButtons, dispatch);

        } catch (err) {
            console.error("MB Error: Failed to load UI configs", err);
        }
    }


    //
    // PAGE DETECTION
    //

    function waitForDomToSettle(callback, idleTime = 1000, timeout = 3000) {
        let observer;
        let lastMutationTime = Date.now();
        let finished = false;

        const done = () => {
            if (finished) return;
            finished = true;
            observer.disconnect();
            clearInterval(checkInterval);
            callback();
        };

        observer = new MutationObserver(() => {
            lastMutationTime = Date.now();
        });

        observer.observe(document.body, { childList: true, subtree: true });

        const checkInterval = setInterval(() => {
            if (Date.now() - lastMutationTime > idleTime) {
                done();
            }
        }, 100);

        setTimeout(() => {
            done();
        }, timeout);
    }

    let lastHref = location.href;

    setInterval(async () => {
        if (location.href !== lastHref && document.readyState === "complete") {
            lastHref = location.href;
            console.log("MB Log: URL changed, waiting for DOM to settle...");
            waitForDomToSettle(() => {
                console.log("MB Log:: DOM settled, refreshing UI...");
                loadUI();
            });
        }
    }, 500);

    loadUI();

    // Resume capture mode if a window.sessionStorage record survived a hard
    // navigation. restoreCaptureMode itself decides whether to restore based
    // on performance navigation type (reload → clear instead of restore).
    getActions().then(m => {
        m.restoreCaptureMode?.();
    }).catch(() => {});

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
