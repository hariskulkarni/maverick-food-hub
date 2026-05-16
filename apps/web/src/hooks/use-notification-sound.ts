'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Lazily-instantiated HTMLAudioElement that respects browser autoplay policies.
 *
 * Behaviour:
 *   - The <audio> element is created on first `play()` call (i.e. after a user
 *     gesture, ideally), so autoplay errors are minimised.
 *   - `play()` returns void; if the underlying play() rejects (autoplay policy,
 *     no codec, etc.) we swallow it silently and disarm any active loop.
 *   - `loop: true` replays the chime on an interval (default 3000 ms) until
 *     `stop()` is called or the component unmounts.
 *   - `enabled` is persisted to localStorage at key `notif-sound-<filename>`.
 *
 * The hook intentionally does NOT auto-play when mounted — the caller decides
 * when to start (e.g. on an SSE event).
 */
export interface UseNotificationSoundOptions {
  loop?: boolean;
  intervalMs?: number;
  enabled?: boolean;
}

export interface UseNotificationSoundResult {
  play: () => void;
  stop: () => void;
  isLooping: boolean;
  enabled: boolean;
  setEnabled: (next: boolean) => void;
}

function storageKey(soundUrl: string): string {
  const filename = soundUrl.split('/').pop() || soundUrl;
  return `notif-sound-${filename}`;
}

export function useNotificationSound(
  soundUrl: string,
  opts: UseNotificationSoundOptions = {}
): UseNotificationSoundResult {
  const { loop = false, intervalMs = 3000, enabled: initialEnabled = true } = opts;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isLooping, setIsLooping] = useState(false);

  const [enabled, setEnabledState] = useState<boolean>(initialEnabled);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Hydrate persisted preference once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(storageKey(soundUrl));
      if (stored != null) setEnabledState(stored === '1');
    } catch {
      // localStorage may be disabled (private browsing / iframe with sandbox)
    }
  }, [soundUrl]);

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(storageKey(soundUrl), next ? '1' : '0');
        } catch {
          // best-effort
        }
      }
      // Turning off mid-loop should stop the current loop immediately.
      if (!next) {
        if (loopTimerRef.current) {
          clearInterval(loopTimerRef.current);
          loopTimerRef.current = null;
        }
        const a = audioRef.current;
        if (a) {
          try { a.pause(); a.currentTime = 0; } catch {}
        }
        setIsLooping(false);
      }
    },
    [soundUrl]
  );

  const ensureAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof window === 'undefined') return null;
    if (audioRef.current) return audioRef.current;
    try {
      const a = new Audio(soundUrl);
      a.preload = 'auto';
      audioRef.current = a;
      return a;
    } catch {
      return null;
    }
  }, [soundUrl]);

  const playOnce = useCallback(() => {
    if (!enabledRef.current) return;
    const a = ensureAudio();
    if (!a) return;
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.then === 'function') {
        p.catch(() => {
          // Autoplay blocked or no user gesture yet — silent fallback.
        });
      }
    } catch {
      // play() can throw synchronously in some legacy browsers
    }
  }, [ensureAudio]);

  const play = useCallback(() => {
    if (!enabledRef.current) return;
    playOnce();
    if (loop) {
      if (loopTimerRef.current) clearInterval(loopTimerRef.current);
      loopTimerRef.current = setInterval(() => {
        if (!enabledRef.current) return;
        playOnce();
      }, intervalMs);
      setIsLooping(true);
    }
  }, [loop, intervalMs, playOnce]);

  const stop = useCallback(() => {
    if (loopTimerRef.current) {
      clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    const a = audioRef.current;
    if (a) {
      try { a.pause(); a.currentTime = 0; } catch {}
    }
    setIsLooping(false);
  }, []);

  // Clean up on unmount: stop any loop and release the audio element.
  useEffect(() => {
    return () => {
      if (loopTimerRef.current) clearInterval(loopTimerRef.current);
      const a = audioRef.current;
      if (a) {
        try { a.pause(); } catch {}
      }
      audioRef.current = null;
    };
  }, []);

  return { play, stop, isLooping, enabled, setEnabled };
}
