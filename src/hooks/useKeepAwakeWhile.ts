// Keeps the screen on while `active` is true. Used by every voice recording
// surface so long meeting-minute or itinerary dictations don't get cut off
// when the phone's auto-lock kicks in. Releases the lock on transition to
// false AND on unmount — so navigating away mid-recording also releases it.

import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

// Tagging the lock means multiple screens recording simultaneously won't
// stomp on each other's release calls (each screen owns its own tag).
export function useKeepAwakeWhile(active: boolean, tag = 'voice-recording'): void {
  useEffect(() => {
    if (!active) return;
    activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => {
      try {
        deactivateKeepAwake(tag);
      } catch {
        // expo-keep-awake throws if the tag is already released; harmless.
      }
    };
  }, [active, tag]);
}
