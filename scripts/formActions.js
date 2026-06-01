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

export const getFormAction = (name) => {
  const fn = registry[name];
  if (!fn) return null;
  return async (args) => {
    const previousInvocation = activeInvocation;
    const previousDescriptor = activeInvocationDescriptor;
    activeInvocation = () => getFormAction(name)(args);
    activeInvocationDescriptor = { name, args };
    try {
      return await fn(args);
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
