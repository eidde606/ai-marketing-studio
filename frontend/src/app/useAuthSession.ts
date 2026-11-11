import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../services/supabaseClient";
import { updateOwnDisplayName } from "../services/profileApi";

/** Keep the initial session lookup from overwriting a newer auth event. */
export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [recoveryUserId, setRecoveryUserId] = useState<string | null>(null);

  async function updateDisplayName(displayName: string): Promise<string> {
    const { displayName: savedName, user } =
      await updateOwnDisplayName(displayName);
    setSession((current) =>
      current && current.user.id === user.id
        ? { ...current, user }
        : current,
    );
    return savedName;
  }
  useEffect(() => {
    let active = true;
    let receivedAuthEvent = false;
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (active && !receivedAuthEvent) {
          setSession(session);
          setCheckingAuth(false);
        }
      })
      .catch(() => {
        if (active && !receivedAuthEvent) setCheckingAuth(false);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (active) {
        receivedAuthEvent = true;
        if (event === "PASSWORD_RECOVERY") {
          setRecoveryUserId(nextSession?.user.id ?? null);
        } else {
          // Recovery belongs to one authenticated account, never the next one.
          setRecoveryUserId((current) =>
            current === nextSession?.user.id ? current : null,
          );
        }

        setSession(nextSession);
        setCheckingAuth(false);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  return {
    session,
    checkingAuth,
    isRecoveringPassword: !!session && recoveryUserId === session.user.id,
    completeRecovery: () => setRecoveryUserId(null),
    signOut: () => supabase.auth.signOut(),
    updateDisplayName,
  };
}
