/** Notifications / alerts recorded by setup.ts mocks. */
const g = globalThis as any;
g.__novaryqQaSent ??= { notify: [], alerts: [] };
export const sent = g.__novaryqQaSent as { notify: { channel: string; args: any }[]; alerts: { fn: string; args: any[] }[] };
