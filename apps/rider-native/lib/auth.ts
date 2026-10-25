/**
 * Auth state for the rider app.
 *
 * The Bearer JWT + rider profile live in expo-secure-store (encrypted device
 * keychain), are restored on launch, and are exposed app-wide via React context.
 * On every token change we also push it into lib/api.ts so requests carry it.
 */
import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { api, ApiError, setAuthToken, type Rider } from './api';
import { saveBackgroundToken, stopDeliveryTracking } from './background-location';

const TOKEN_KEY = 'flavrly_rider_token';
const RIDER_KEY = 'flavrly_rider_profile';
/** Set when the server ended the session; the login screen shows it once. */
const SESSION_ENDED_KEY = 'flavrly_rider_session_ended';

/** Refresh when the token has less than this left (or has no readable exp). */
const REFRESH_WINDOW_SECONDS = 3 * 24 * 60 * 60;

/** Decode the JWT payload's `exp` (seconds). Null when unreadable. */
export function tokenExp(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(globalThis.atob(padded));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

export function needsRefresh(token: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const exp = tokenExp(token);
  return exp == null || exp - nowSeconds < REFRESH_WINDOW_SECONDS;
}

interface AuthState {
  token: string | null;
  rider: Rider | null;
  /** True until the persisted token has been read on launch. */
  loading: boolean;
  signIn: (token: string, rider: Rider) => Promise<void>;
  signOut: () => Promise<void>;
  /** The server ended the session (revoked / expired): sign out and tell the rider why. */
  endSession: () => Promise<void>;
  /** One-shot: returns true (and clears the flag) if the last session was ended by the server. */
  consumeSessionEnded: () => Promise<boolean>;
  updateRider: (patch: Partial<Rider>) => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [rider, setRider] = useState<Rider | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the persisted session on launch.
  useEffect(() => {
    (async () => {
      try {
        const [savedToken, savedRider] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(RIDER_KEY),
        ]);
        if (savedToken) {
          setToken(savedToken);
          setAuthToken(savedToken);
          // Copy readable while the phone is locked, for the background
          // delivery-tracking task (also migrates sessions from older builds).
          saveBackgroundToken(savedToken).catch(() => {});
        }
        if (savedRider) {
          try {
            setRider(JSON.parse(savedRider) as Rider);
          } catch {
            // Corrupt profile blob — ignore; token alone still authenticates.
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (newToken: string, newRider: Rider) => {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, newToken),
      SecureStore.setItemAsync(RIDER_KEY, JSON.stringify(newRider)),
    ]);
    await saveBackgroundToken(newToken);
    setAuthToken(newToken);
    setToken(newToken);
    setRider(newRider);
  }, []);

  const clearLocal = useCallback(async () => {
    // End any background delivery tracking and drop unsent points + the
    // background token copy before the session goes away.
    await stopDeliveryTracking({ clearQueue: true }).catch(() => {});
    await Promise.all([
      saveBackgroundToken(null),
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(RIDER_KEY),
    ]);
    setAuthToken(null);
    setToken(null);
    setRider(null);
  }, []);

  const signOut = useCallback(async () => {
    // Revoke the server session + push token first (best-effort, bounded) so
    // a copied token can't keep working after the rider signs out.
    await Promise.race([
      api.logout().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
    await clearLocal();
  }, [clearLocal]);

  const endSession = useCallback(async () => {
    await SecureStore.setItemAsync(SESSION_ENDED_KEY, '1').catch(() => {});
    await clearLocal();
  }, [clearLocal]);

  const consumeSessionEnded = useCallback(async () => {
    const v = await SecureStore.getItemAsync(SESSION_ENDED_KEY).catch(() => null);
    if (v) await SecureStore.deleteItemAsync(SESSION_ENDED_KEY).catch(() => {});
    return !!v;
  }, []);

  // Sliding refresh: on launch (once the token is restored) and whenever the
  // app returns to the foreground, swap a token that is close to expiry (or a
  // legacy token without a readable exp) for a fresh one. A 401 means the
  // server session is over → sign out with the "session ended" notice.
  const refreshing = useRef(false);
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const maybeRefresh = useCallback(async () => {
    const current = tokenRef.current;
    if (!current || refreshing.current || !needsRefresh(current)) return;
    refreshing.current = true;
    try {
      const res = await api.refreshToken();
      if (tokenRef.current !== current) return; // signed out / swapped meanwhile
      await SecureStore.setItemAsync(TOKEN_KEY, res.token);
      // Keep the background delivery-tracking task's copy in step, or it would
      // keep sending the old token until that one expires.
      await saveBackgroundToken(res.token);
      setAuthToken(res.token);
      setToken(res.token);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await endSession();
      // Anything else (offline, 5xx, older server without the endpoint) — keep
      // the current token and try again next foreground.
    } finally {
      refreshing.current = false;
    }
  }, [endSession]);

  useEffect(() => {
    if (loading || !token) return;
    maybeRefresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') maybeRefresh();
    });
    return () => sub.remove();
  }, [loading, token, maybeRefresh]);

  const updateRider = useCallback(async (patch: Partial<Rider>) => {
    setRider((prev) => {
      const next: Rider = {
        id: prev?.id ?? '',
        name: prev?.name ?? null,
        phone: prev?.phone ?? null,
        ...patch,
      };
      SecureStore.setItemAsync(RIDER_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return React.createElement(
    AuthContext.Provider,
    { value: { token, rider, loading, signIn, signOut, endSession, consumeSessionEnded, updateRider } },
    children
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
