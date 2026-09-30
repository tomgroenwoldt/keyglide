import { create } from "zustand";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import { Database, Tables } from "./database.types";

interface AppState {
    user: User | null;
    setUser: (user: User | null) => void;
    authLoaded: boolean;
    setAuthLoaded: (loaded: boolean) => void;
    profile: Tables<"profiles"> | null;
    setProfile: (profile: Tables<"profiles"> | null) => void;
    supabase: SupabaseClient<Database>;
}

export const useAppStore = create<AppState>()((set) => ({
    user: null,
    setUser: (user: User | null) => set((state) => ({ ...state, user: user })),
    authLoaded: false,
    setAuthLoaded: (loaded: boolean) =>
        set((state) => ({ ...state, authLoaded: loaded })),
    profile: null,
    setProfile: (profile: Tables<"profiles"> | null) =>
        set((state) => ({ ...state, profile: profile })),
    supabase: createClient<Database>(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    ),
}));
