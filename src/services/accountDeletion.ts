// In-app account deletion (App Store Review Guideline 5.1.1(v): deleting an
// account must be initiable from inside the app, not just deactivation and not
// only by emailing support).
//
// This is the short path. A signed-in user already holds a proven identity, so
// there is nothing to confirm by email: the app calls the delete-account edge
// function with its own JWT and the account is gone when the call returns. The
// web flow (request-account-deletion → emailed token → confirm-account-deletion
// → delete-account) exists only for people who no longer have the app
// installed, which is what Google Play requires.
//
// The edge function derives the target user from the JWT's `sub` claim and
// ignores any user_id in the body, so there is no parameter here that could
// name someone else's account — see the auth-model note in
// supabase/functions/delete-account/index.ts.

import { supabase } from './supabase';

export interface DeleteAccountResult {
  // True only when the auth row itself was removed. The function reports
  // storage/bookkeeping problems separately and never lets them abort the
  // deletion, so a `true` here with a non-empty residualErrors is a completed
  // deletion that left some files behind — the account is still gone.
  ok: boolean;
  residualErrors: string[];
}

// The function replies 500 with a JSON body when auth deletion fails, which
// supabase-js surfaces as a FunctionsHttpError carrying the raw Response rather
// than the message. Dig the server's own wording out of it so the user is told
// what actually went wrong instead of "Edge Function returned a non-2xx status".
async function messageFromInvokeError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      const serverMessage = (body as { error?: unknown }).error;
      if (typeof serverMessage === 'string' && serverMessage.trim()) return serverMessage;
    } catch {
      // Body was not JSON (platform-level 401/504 pages land here). Fall through.
    }
  }
  return error instanceof Error ? error.message : String(error);
}

// Permanently deletes the signed-in user's account, then clears the local
// session. Throws with a user-presentable message if the account still exists.
export async function deleteAccount(): Promise<DeleteAccountResult> {
  // Forces a refresh if the stored access token is expired: an expired JWT is
  // rejected by the platform before delete-account runs, and the user would see
  // a 401 they can do nothing about.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error('Not signed in');

  const { data, error } = await supabase.functions.invoke('delete-account', {
    body: {},
  });
  if (error) throw new Error(await messageFromInvokeError(error));

  const result = (data ?? {}) as { ok?: boolean; error?: string; residualErrors?: string[] };
  if (!result.ok) {
    throw new Error(result.error ?? 'The account could not be deleted. Please try again.');
  }

  // scope: 'local' on purpose. The default global sign-out asks the server to
  // revoke the session, and the user it belonged to no longer exists — that
  // call fails and would leave a dead session in AsyncStorage. Clearing locally
  // is all that is left to do, and it fires SIGNED_OUT so AuthContext returns
  // the app to the login screen.
  await supabase.auth.signOut({ scope: 'local' });

  return {
    ok: true,
    residualErrors: Array.isArray(result.residualErrors) ? result.residualErrors : [],
  };
}
