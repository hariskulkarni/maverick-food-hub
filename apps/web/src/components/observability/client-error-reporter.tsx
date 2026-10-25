'use client';
/**
 * Installs window.onerror + unhandledrejection listeners once per page and
 * forwards errors to the observability beacon. Renders nothing.
 */
import { useEffect } from 'react';
import { reportClientError } from './report-client-error';

export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => reportClientError(ev.error ?? ev.message, { type: 'error' });
    const onRejection = (ev: PromiseRejectionEvent) => reportClientError(ev.reason, { type: 'unhandledrejection' });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
