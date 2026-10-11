import { useSyncExternalStore, type MouseEvent } from 'react';

// Minimal router on the History API: path and query parameters come straight from the URL.
// The server serves index.html for unknown paths, so reloads on /items/123 work too.
// On GitHub Pages the app lives under a subpath (e.g. /gw2-fractal-items/, Vite option base) and 404.html is
// a copy of index.html. Internally the app always uses paths without the base ("/items/123"); the base
// is only added when reading and writing the address bar and for href.

// import.meta.env is Vite's build-time environment; BASE_URL comes from the `base` option in vite.config.ts.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, ''); // "" or "/gw2-fractal-items"

/** App path -> path in the address bar / in href. */
export const withBase = (url: string): string => BASE + url;

/** Address-bar path -> app path (inverse of withBase). */
function stripBase(pathname: string): string {
    if (!BASE || !pathname.startsWith(BASE)) return pathname;
    const rest = pathname.slice(BASE.length);
    return rest === '' ? '/' : rest.startsWith('/') ? rest : pathname;
}

// The History API fires no event on pushState, so navigate() dispatches this custom event itself.
const EVENT = 'app:navigate';

// Subscribe function for useSyncExternalStore: calls `callback` on every URL change, returns the unsubscribe function.
function subscribe(callback: () => void): () => void {
    window.addEventListener('popstate', callback);
    window.addEventListener(EVENT, callback);
    return () => {
        window.removeEventListener('popstate', callback);
        window.removeEventListener(EVENT, callback);
    };
}

// Current app path + query string; useSyncExternalStore re-renders when this string changes.
function snapshot(): string {
    return stripBase(window.location.pathname) + window.location.search;
}

/** Changes the URL without a page reload. `replace` overwrites the current history entry instead of adding one. */
export function navigate(url: string, options: { replace?: boolean } = {}): void {
    if (url === snapshot()) return;
    if (options.replace) window.history.replaceState(null, '', withBase(url));
    else window.history.pushState(null, '', withBase(url));
    window.dispatchEvent(new Event(EVENT));
    if (!options.replace) window.scrollTo(0, 0);
}

export interface Location {
    path: string;
    params: URLSearchParams;
}

/** React hook: current path and query parameters; the component re-renders on every navigation. */
export function useLocation(): Location {
    const current = useSyncExternalStore(subscribe, snapshot);
    const url = new URL(current, window.location.origin);
    return { path: url.pathname, params: url.searchParams };
}

/** Click handler for <a href>: normal clicks stay in the app, Ctrl/middle click opens a new tab. */
export function linkHandler(href: string) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }
        event.preventDefault();
        navigate(href);
    };
}
