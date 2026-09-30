/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
    /** Optional. When unset, no analytics are loaded. */
    readonly VITE_GA_MEASUREMENT_ID?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

interface Window {
    dataLayer: unknown[];
}
