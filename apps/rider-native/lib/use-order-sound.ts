/**
 * useOrderSound — plays a short "ping" + vibration whenever a new pool order
 * lands or the rider's assignment changes.
 *
 * The actual audio module is loaded *dynamically* so the app keeps running on
 * a device / build where `expo-audio` (or `expo-av`) isn't installed yet — in
 * that case the hook silently no-ops on audio and falls back to vibration
 * only. This matters because the sound asset
 * (`assets/sounds/new-order.mp3`) is dropped in by a sibling agent and may
 * not be present on every build.
 *
 * The hook tries `expo-audio` first (SDK 54+ recommended API) and falls back
 * to `expo-av` if only that is present. We never throw — every audio path is
 * wrapped in try/catch.
 */
import { useEffect, useRef, useCallback } from 'react';
import { Vibration } from 'react-native';

// MP3 dropped by a sibling agent at runtime. We resolve the asset via a
// static `require()` so Metro can bundle it — but to keep the app running on
// older builds where the file is missing, we wrap in try/catch. (Metro is
// usually fine with this; if it ever isn't, we fall back to vibration-only.)
//
// NOTE: if you see "Unable to resolve module ../assets/sounds/new-order.mp3"
// at bundle time, drop a placeholder MP3 at that path and re-bundle.
let soundAsset: number | null = null;
try {
  soundAsset = require('../assets/sounds/new-order.mp3');
} catch {
  soundAsset = null;
}

// A vibration pattern with two short pulses followed by a long one — distinct
// enough to register as "delivery ping" even when the phone is in a pocket.
const VIBRATION_PATTERN = [0, 200, 100, 200, 100, 400];

interface PlayerHandle {
  play: () => Promise<void>;
  unload: () => Promise<void>;
}

/**
 * Try to build a player using whichever audio library is installed.
 * Returns null if neither is available (or the asset is missing) — callers
 * then degrade to vibration-only.
 */
async function buildPlayer(): Promise<PlayerHandle | null> {
  if (!soundAsset) return null;

  // Prefer expo-audio (SDK 54+).
  try {
    const audio = await import('expo-audio');
    // expo-audio exposes `createAudioPlayer(source)` which returns a player
    // with `play()` / `remove()` methods. Some shapes vary across point
    // releases; we feature-detect rather than assume.
    const anyAudio: any = audio;
    if (typeof anyAudio.createAudioPlayer === 'function') {
      const player = anyAudio.createAudioPlayer(soundAsset);
      return {
        play: async () => {
          try {
            // Rewind first so back-to-back orders both make a sound.
            if (typeof player.seekTo === 'function') {
              await player.seekTo(0);
            }
            player.play();
          } catch {
            /* swallow */
          }
        },
        unload: async () => {
          try {
            if (typeof player.remove === 'function') player.remove();
            else if (typeof player.release === 'function') player.release();
          } catch {
            /* swallow */
          }
        },
      };
    }
  } catch {
    // expo-audio not installed — try expo-av below.
  }

  // Fallback: expo-av (older API, still works in SDK 54). We don't list it as
  // a dependency, so the TS import is suppressed — this whole branch is a
  // runtime safety net for legacy builds that still bundle expo-av.
  try {
    // @ts-expect-error — expo-av is an optional runtime dependency.
    // eslint-disable-next-line import/no-unresolved -- expo-av is an optional runtime-only fallback, intentionally not a dependency
    const av: any = await import('expo-av');
    const { Sound } = av.Audio;
    const { sound } = await Sound.createAsync(soundAsset);
    return {
      play: async () => {
        try {
          await sound.setPositionAsync(0);
          await sound.playAsync();
        } catch {
          /* swallow */
        }
      },
      unload: async () => {
        try {
          await sound.unloadAsync();
        } catch {
          /* swallow */
        }
      },
    };
  } catch {
    return null;
  }
}

export interface OrderSoundApi {
  /** Loud-and-vibrate cue for a freshly-appeared pool order. */
  playNewOrder: () => void;
  /** Same cue, fired when the rider's assignment changes (e.g. dispatcher push). */
  playAssignment: () => void;
}

export function useOrderSound(): OrderSoundApi {
  const playerRef = useRef<PlayerHandle | null>(null);
  const readyRef = useRef(false);

  // Pre-load on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const handle = await buildPlayer();
        if (cancelled) {
          await handle?.unload();
          return;
        }
        playerRef.current = handle;
        readyRef.current = true;
      } catch {
        // Never throw — silent fallback to vibration-only.
      }
    })();
    return () => {
      cancelled = true;
      const handle = playerRef.current;
      playerRef.current = null;
      handle?.unload().catch(() => {});
    };
  }, []);

  const cue = useCallback(() => {
    try {
      Vibration.vibrate(VIBRATION_PATTERN);
    } catch {
      /* swallow */
    }
    try {
      playerRef.current?.play().catch(() => {});
    } catch {
      /* swallow */
    }
  }, []);

  return {
    playNewOrder: cue,
    playAssignment: cue,
  };
}
