/**
 * Auth state for the rider app.
 *
 * The Bearer JWT + rider profile live in expo-secure-store (encrypted device
 * keychain), are restored on launch, and are exposed app-wide via React context.
 * On every token change we also push it into lib/api.ts so requests carry it.
 */
import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { setAuthToken, type Rider } from './api';

const TOKEN_KEY = 'oas_rider_token';
const RIDER_KEY = 'oas_rider_profile';

interface AuthState {
  token: string | null;
  rider: Rider | null;
  /** True until the persisted token has been read on launch. */
  loading: boolean;
  signIn: (token: string, rider: Rider) => Promise<void>;
  signOut: () => Promise<void>;
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
    setAuthToken(newToken);
    setToken(newToken);
    setRider(newRider);
  }, []);

  const signOut = useCallback(async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(RIDER_KEY),
    ]);
    setAuthToken(null);
    setToken(null);
    setRider(null);
  }, []);

  return React.createElement(
    AuthContext.Provider,
    { value: { token, rider, loading, signIn, signOut } },
    children
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
