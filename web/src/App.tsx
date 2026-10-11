import { useRef } from 'react';
import { navigate, useLocation } from './lib/router';
import { listUrl, parseFilters, DEFAULT_FILTERS, type ListFilters } from './lib/filters';
import { Header } from './components/Header';
import { ItemListPage } from './components/ItemListPage';
import { ItemDetailPage } from './components/ItemDetailPage';
import type { FilterChange } from './components/FilterBar';
import { CompareRoute, UpdateChangesPage, UpdatesRedirect } from './components/UpdateChangesPage';
import { Link } from './components/common';
import { useT } from './lib/i18n';

// Root component with a tiny hand-written router (see lib/router.ts): it matches the URL path and renders one page.
// Routes: "/" = list (filters in the query parameters), "/items/:id" = detail view,
// "/updates/:id" = changes of an update, "/updates" = redirect to the latest.
export function App() {
    const { t } = useT(); // t(key) returns the UI text in the current language

    const { path, params } = useLocation();
    const detailMatch = /^\/items\/(\d+)\/?$/.exec(path);
    const updateMatch = /^\/updates\/(\d+)\/?$/.exec(path);
    const compareMatch = /^\/updates\/compare\/?$/.test(path);
    const isUpdatesRoot = /^\/updates\/?$/.test(path);
    const isList = path === '/';

    // Remember the last list URL so "Back to list" and the tabs keep the filters.
    // useRef keeps a value across renders without triggering a re-render when it changes.
    const lastList = useRef<ListFilters>(DEFAULT_FILTERS);
    if (isList) lastList.current = parseFilters(params);
    const filters = lastList.current;

    // Merges a filter change into the current filters and navigates to the resulting list URL.
    const changeFilters: FilterChange = (change, options = {}) => {
        // Every filter change jumps to page 1, except when paging itself.
        const next = { ...filters, ...change, page: options.keepPage ? (change.page ?? filters.page) : 1 };
        navigate(listUrl(next), { replace: options.replace });
    };

    return (
        <div className="app">
            <Header
                filters={filters}
                activeView={isList ? filters.view : null}
                changesActive={!!updateMatch || compareMatch || isUpdatesRoot}
            />
            <main className="content">
                {isList && <ItemListPage filters={filters} onChange={changeFilters} />}
                {detailMatch && <ItemDetailPage id={Number(detailMatch[1])} backHref={listUrl(filters)} />}
                {updateMatch && <UpdateChangesPage source={{ id: Number(updateMatch[1]) }} params={params} />}
                {compareMatch && <CompareRoute params={params} />}
                {isUpdatesRoot && <UpdatesRedirect />}
                {!isList && !detailMatch && !updateMatch && !compareMatch && !isUpdatesRoot && (
                    <div className="empty">
                        <p>{t('app.notFound')}</p>
                        <Link href="/">{t('app.toList')}</Link>
                    </div>
                )}
            </main>
            <footer className="app-footer small muted">{t('footer.legal')}</footer>
        </div>
    );
}
