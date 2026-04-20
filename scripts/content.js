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
            const link = document.createElement('link');
            link.id = 'google-material-icons-css';
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';
            document.head.appendChild(link);

            const style = document.createElement('style');
            style.textContent = `.material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-style: normal; user-select: none; }`;
            document.head.appendChild(style);
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

    // ---- GLOBAL POSITIONING MANAGER (for repositioning relative containers on scroll/zoom) ----
    if (!window.__mbGlobalPositioningAttached) {
        window.__mbGlobalPositioningAttached = true;

        function updateAllRelativeContainers() {
            const nodes = document.querySelectorAll('.more-buttons-container[data-relative-to-id]');
            nodes.forEach(el => {
                if (getComputedStyle(el).display === "none") return;
                if (typeof el.__mbPositionOnce === "function") {
                    el.__mbPositionOnce();
                }
            });
        }

        let rafId = null;
        function scheduleUpdate() {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                updateAllRelativeContainers();
            });
        }

        window.addEventListener("scroll", scheduleUpdate, { passive: true });
        window.addEventListener("resize", scheduleUpdate);
        if (window.visualViewport) {
            window.visualViewport.addEventListener("scroll", scheduleUpdate, { passive: true });
            window.visualViewport.addEventListener("resize", scheduleUpdate);
        }

        window.__mbPositioning = { scheduleUpdate, updateAllRelativeContainers };
    }

    // Unified loader for containers + buttons + automations
    async function loadUI() {
        try {
            const [
                { createButton },
                { createContainer },
                { runAutomations },
                { pageMatchesUrl },
            ] = await Promise.all([
                import(chrome.runtime.getURL('scripts/buttons.js')),
                import(chrome.runtime.getURL('scripts/containers.js')),
                import(chrome.runtime.getURL('scripts/automations.js')),
                import(chrome.runtime.getURL('scripts/utils.js')),
            ]);

            const [buttonsRes, containersRes, automationsRes] = await Promise.all([
                fetch(chrome.runtime.getURL("config/buttons.json")),
                fetch(chrome.runtime.getURL("config/containers.json")),
                fetch(chrome.runtime.getURL("config/automations.json")),
            ]);

            const buttons = await buttonsRes.json();
            const containers = await containersRes.json();
            const automations = await automationsRes.json();

            const url = window.location.href;
            const matchedButtons = buttons.filter(btn => pageMatchesUrl(btn.pageMatch, url));
            const matchedAutomations = automations.filter(auto => pageMatchesUrl(auto.pageMatch, url));

            if (!matchedButtons.length && !matchedAutomations.length) return;

            console.log("MB Log: URL match detected. Rendering buttons / running automations...");
            injectGoogleMaterialIcons();

            const dispatch = (action) => {
                import(chrome.runtime.getURL('scripts/actions.js')).then(module => {
                    const [name, ...params] = action.split(':');
                    const fn = module[name];
                    if (typeof fn === 'function') fn(...params);
                    else console.warn(`MB Warn: Action "${name}" not found in actions.js`);
                });
            };

            runAutomations(matchedAutomations, dispatch);

            const containerMap = Object.fromEntries(containers.map(c => [c.id, c]));
            const createdContainerIds = new Set();

            matchedButtons.forEach(button => {
                const containerId = button.containerId;
                const containerDef = containerMap[containerId];
                if (!containerDef) {
                    console.warn(`MB Warn: No container definition for containerId: ${containerId}`);
                    return;
                }
                if (containerDef.context === "popup") return;

                if (!document.getElementById(containerId) && !createdContainerIds.has(containerId)) {
                    const containerEl = createContainer(containerDef);
                    document.body.appendChild(containerEl);
                    createdContainerIds.add(containerId);
                }

                const containerEl = document.getElementById(containerId);
                if (!containerEl) return;

                const existingBtn = containerEl.querySelector(`#${button.id}`);
                if (existingBtn) existingBtn.remove();

                containerEl.appendChild(createButton(button, dispatch));
            });

            window.__mbPositioning?.scheduleUpdate();

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
        console.log("MB Log: Searching for changes...");

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

});

// Listen for action requests from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "runAction") return;
    const { actionName, params } = message;
    import(chrome.runtime.getURL("scripts/actions.js")).then(module => {
        const fn = module[actionName];
        if (typeof fn === "function") fn(...(params ?? []));
        sendResponse({ ok: true });
    });
    return true;
});
