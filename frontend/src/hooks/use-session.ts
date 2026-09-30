import { useEffect, useState } from "react";
import { Session } from "@supabase/supabase-js";

import { useAppStore } from "@/store";

export interface SessionState {
    session: Session | null;
    /** The current access token, or undefined when signed out. */
    accessToken: string | undefined;
    /** False until the initial session lookup has resolved. */
    ready: boolean;
}

/**
 * Tracks the Supabase session and keeps it in sync with auth state changes.
 *
 * Components that pass the access token to the backend should wait for
 * `ready` before mounting, otherwise they open their connection without a
 * token and the request is treated as anonymous.
 */
export function useSession(): SessionState {
    const { supabase } = useAppStore();

    const [session, setSession] = useState<Session | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setReady(true);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setReady(true);
        });

        return () => subscription.unsubscribe();
    }, [supabase.auth]);

    return { session, accessToken: session?.access_token, ready };
}
