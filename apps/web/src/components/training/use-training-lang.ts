'use client';
import { useCallback, useEffect, useState } from 'react';

export type TrainingLang = 'en' | 'hi';
const KEY = 'flv.training.lang';

/** Per-viewer content language (a convenience; falls back to English). */
export function useTrainingLang(): [TrainingLang, (l: TrainingLang) => void] {
  const [lang, setLangState] = useState<TrainingLang>('en');
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      if (v === 'hi' || v === 'en') setLangState(v);
    } catch {
      /* storage unavailable — stay on English */
    }
  }, []);
  const setLang = useCallback((l: TrainingLang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  }, []);
  return [lang, setLang];
}
