import { useSyncExternalStore, type MouseEvent } from 'react';

// Minimaler Router über die History API: Pfad und Query-Parameter kommen direkt aus der URL.
// Der Server liefert für unbekannte Pfade index.html aus, daher funktionieren auch Reloads auf /items/123.

const EVENT = 'app:navigate';

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(EVENT, callback);
  };
}

function snapshot(): string {
  return window.location.pathname + window.location.search;
}

export function navigate(url: string, options: { replace?: boolean } = {}): void {
  if (url === snapshot()) return;
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(EVENT));
  if (!options.replace) window.scrollTo(0, 0);
}

export interface Location {
  path: string;
  params: URLSearchParams;
}

export function useLocation(): Location {
  const current = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(current, window.location.origin);
  return { path: url.pathname, params: url.searchParams };
}

/** Klick-Handler für <a href>: normale Klicks bleiben in der App, Strg/Mittelklick öffnet einen neuen Tab. */
export function linkHandler(href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(href);
  };
}
