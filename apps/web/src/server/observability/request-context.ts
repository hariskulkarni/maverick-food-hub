/**
 * Per-request context (request id, method, path, route) carried through the
 * whole handler via AsyncLocalStorage. Set by the HTTP recorder; read by the
 * error store so every captured exception carries the request id and route.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ObsRequestContext {
  requestId: string;
  method: string;
  path: string;
  route: string;
  startedAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __obsAls: AsyncLocalStorage<ObsRequestContext> | undefined;
}

export function requestStore(): AsyncLocalStorage<ObsRequestContext> {
  if (!global.__obsAls) global.__obsAls = new AsyncLocalStorage<ObsRequestContext>();
  return global.__obsAls;
}

export function currentRequest(): ObsRequestContext | undefined {
  try {
    return requestStore().getStore();
  } catch {
    return undefined;
  }
}
