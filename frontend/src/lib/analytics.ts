/**
 * Loads Google Analytics, but only when a measurement ID is configured.
 *
 * Forks and local development leave `VITE_GA_MEASUREMENT_ID` unset, so no
 * request to Google is made and nothing is reported to anyone else's property.
 */
export function setupAnalytics() {
    const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
    if (!measurementId) return;

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag(...args: unknown[]) {
        window.dataLayer.push(args);
    }
    gtag("js", new Date());
    gtag("config", measurementId);
}
