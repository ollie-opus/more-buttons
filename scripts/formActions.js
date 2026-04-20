const registry = {};
export const registerFormAction = (name, fn) => { registry[name] = fn; };
export const getFormAction = (name) => registry[name] ?? null;
