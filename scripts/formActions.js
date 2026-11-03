const registry = {};

// Tracks how the form action currently executing was invoked, so form.js can
// auto-capture a faithful "re-open me" opener for back-navigation. Without this,
// every createForm caller had to hand-pass a correct opener — getting it wrong
// silently broke Back (e.g. a child landing on the grandparent).
let activeInvocation = null;
// Serialisable counterpart of activeInvocation: { name, args }. Used by
// capture-mode auto-reopen, which has to survive a page navigation and so
// can't rely on a closure.
let activeInvocationDescriptor = null;

export const registerFormAction = (name, fn) => { registry[name] = fn; };

// Observers of finished form actions: { before() → mark, after(name, args, mark) }.
// `before` runs as the action starts, `after` once it resolves (never on a
// throw), so an observer can tell whether this action mounted a new form —
// e.g. the guide Live/Draft switch decorating the screen an opener just built.
// Observers must not throw or block; `after` is not awaited.
const completeHooks = [];
export const onFormActionComplete = (hook) => { completeHooks.push(hook); };

export const getFormAction = (name) => {
  const fn = registry[name];
  if (!fn) return null;
  return async (args) => {
    const previousInvocation = activeInvocation;
    const previousDescriptor = activeInvocationDescriptor;
    activeInvocation = () => getFormAction(name)(args);
    activeInvocationDescriptor = { name, args };
    try {
      const marks = completeHooks.map(h => { try { return h.before?.(); } catch { return undefined; } });
      const result = await fn(args);
      completeHooks.forEach((h, i) => { try { h.after(name, args, marks[i]); } catch (err) { console.warn('[MB] form action hook failed:', err); } });
      return result;
    } finally {
      activeInvocation = previousInvocation;
      activeInvocationDescriptor = previousDescriptor;
    }
  };
};

// The opener that replays the form action currently mid-execution (or null when
// no registered action is running, e.g. a direct createForm call).
export const currentOpener = () => activeInvocation;
export const currentInvocationDescriptor = () => activeInvocationDescriptor;
