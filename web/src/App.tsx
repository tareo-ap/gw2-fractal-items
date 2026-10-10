import { useRef } from 'react';
import { navigate, useLocation } from './lib/router';
import { listUrl, parseFilters, DEFAULT_FILTERS, type ListFilters } from './lib/filters';
import { Header } from './components/Header';
import { ItemListPage } from './components/ItemListPage';
import { ItemDetailPage } from './components/ItemDetailPage';
import type { FilterChange } from './components/FilterBar';
import { UpdateChangesPage, UpdatesRedirect } from './components/UpdateChangesPage';
import { Link } from './components/common';

// Routen: "/" = Liste (Filter in den Query-Parametern), "/items/:id" = Detailansicht,
// "/updates/:id" = Änderungen eines Updates, "/updates" = Weiterleitung auf das neueste.
export function App() {
  const { path, params } = useLocation();
  const detailMatch = /^\/items\/(\d+)\/?$/.exec(path);
  const updateMatch = /^\/updates\/(\d+)\/?$/.exec(path);
  const isUpdatesRoot = /^\/updates\/?$/.test(path);
  const isList = path === '/';

  // Letzte Listen-URL merken, damit "Zurück zur Liste" und die Tabs die Filter behalten.
  const lastList = useRef<ListFilters>(DEFAULT_FILTERS);
  if (isList) lastList.current = parseFilters(params);
  const filters = lastList.current;

  const changeFilters: FilterChange = (change, options = {}) => {
    // Jede Filteränderung springt auf Seite 1, außer beim Blättern selbst.
    const next = { ...filters, ...change, page: options.keepPage ? (change.page ?? filters.page) : 1 };
    navigate(listUrl(next), { replace: options.replace });
  };

  return (
    <div className="app">
      <Header filters={filters} activeView={isList ? filters.view : null} changesActive={!!updateMatch || isUpdatesRoot} />
      <main className="content">
        {isList && <ItemListPage filters={filters} onChange={changeFilters} />}
        {detailMatch && <ItemDetailPage id={Number(detailMatch[1])} backHref={listUrl(filters)} />}
        {updateMatch && <UpdateChangesPage id={Number(updateMatch[1])} params={params} />}
        {isUpdatesRoot && <UpdatesRedirect />}
        {!isList && !detailMatch && !updateMatch && !isUpdatesRoot && (
          <div className="empty">
            <p>Diese Seite gibt es nicht.</p>
            <Link href="/">Zur Liste</Link>
          </div>
        )}
      </main>
    </div>
  );
}
