// Tiny pub/sub for the latest ClassifiedNote produced by the Dashboard mic.
// Screens consume it on focus and clear it after pre-filling.

import { useEffect, useState } from 'react';
import type { ClassifiedNote } from './openai';

type Listener = (note: ClassifiedNote | null) => void;

let current: ClassifiedNote | null = null;
const listeners = new Set<Listener>();

export function publish(note: ClassifiedNote): void {
  current = note;
  listeners.forEach((l) => l(current));
}

export function consume(): ClassifiedNote | null {
  const v = current;
  current = null;
  listeners.forEach((l) => l(null));
  return v;
}

export function peek(): ClassifiedNote | null {
  return current;
}

export function useVoiceInbox(): ClassifiedNote | null {
  const [note, setNote] = useState<ClassifiedNote | null>(current);
  useEffect(() => {
    listeners.add(setNote);
    return () => {
      listeners.delete(setNote);
    };
  }, []);
  return note;
}
