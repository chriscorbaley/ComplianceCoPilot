// Resolve private-bucket business logos into displayable signed URLs.
//
// businesses.logo_url stores a storage PATH (the 'business-logos' bucket is
// private), so <Image> cannot render it directly. These hooks mint short-lived
// signed URLs on demand and re-mint them whenever the screen regains focus, so a
// re-uploaded logo re-fetches and an expired signature is refreshed.

import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getSignedLogoUrl } from '../services/businesses';
import type { BusinessRow } from '../services/supabase';

// Single logo (e.g. the active business or an edit-screen thumbnail). Pass a
// local file:// URI straight through — a freshly-picked image isn't in storage
// yet and must show instantly.
export function useSignedLogoUrl(logoUrl: string | null | undefined): string | null {
  const [signed, setSigned] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!logoUrl) {
        setSigned(null);
        return;
      }
      // A freshly-picked local image (file://, ph://, content://, …) isn't in
      // storage yet — show it as-is. Only http(s) URLs and bare storage paths
      // get signed.
      if (/^[a-z]+:/i.test(logoUrl) && !/^https?:/i.test(logoUrl)) {
        setSigned(logoUrl);
        return;
      }
      getSignedLogoUrl(logoUrl)
        .then((url) => {
          if (active) setSigned(url);
        })
        .catch(() => {
          if (active) setSigned(null);
        });
      return () => {
        active = false;
      };
    }, [logoUrl]),
  );

  return signed;
}

// A map of businessId -> signed logo URL (or null) for lists that show many
// logos at once (the header switcher, the Businesses screen).
export function useSignedLogoUrls(businesses: BusinessRow[]): Record<string, string | null> {
  const [urls, setUrls] = useState<Record<string, string | null>>({});

  // Re-sign only when the set of (id, logo_url) pairs changes, not on every
  // render — otherwise the effect would loop forever.
  const key = businesses.map((b) => `${b.id}:${b.logo_url ?? ''}`).join('|');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const withLogos = businesses.filter((b) => b.logo_url);
      if (withLogos.length === 0) {
        setUrls({});
        return;
      }
      Promise.all(
        withLogos.map(async (b) => [b.id, await getSignedLogoUrl(b.logo_url)] as const),
      )
        .then((entries) => {
          if (active) setUrls(Object.fromEntries(entries));
        })
        .catch(() => {
          if (active) setUrls({});
        });
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]),
  );

  return urls;
}
