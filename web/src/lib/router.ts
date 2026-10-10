import { useSyncExternalStore, type MouseEvent } from 'react';

// Minimaler Router über die History API: Pfad und Query-Parameter kommen direkt aus der URL.
// Der Server liefert für unbekannte Pfade index.html aus, daher funktionieren auch Reloads auf /items/123.
// Auf GitHub Pages liegt die App unter einem Unterpfad (z. B. /gw2_items/, Vite-Option base) und 404.html ist
// eine Kopie von index.html. Die App rechnet intern immer mit Pfaden ohne Basis ("/items/123"); die Basis
// kommt nur beim Lesen und Schreiben der Browserzeile und bei href dazu.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, ''); // "" oder "/gw2_items"

/** App-Pfad → Pfad in der Browserzeile / im href. */
export const withBase = (url: string): string => BASE + url;

function stripBase(pathname: string): string {
  if (!BASE || !pathname.startsWith(BASE)) return pathname;
  const rest = pathname.slice(BASE.length);
  return rest === '' ? '/' : rest.startsWith('/') ? rest : pathname;
}

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
  return stripBase(window.location.pathname) + window.location.search;
}

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
