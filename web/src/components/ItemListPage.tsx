import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ItemListItem } from '../../../shared/types';
import { api } from '../api';
import { downloadStaticExport } from '../lib/staticApi';
import { rarityClass, wikiSearchUrl } from '../lib/format';
import { errorText, useT } from '../lib/i18n';
import { PAGE_SIZE, exportUrl, toApiQuery, type ListFilters } from '../lib/filters';
import { ErrorBox, GameTypeBadges, ItemIcon, Link, Loading, TestBadge } from './common';
import { Gw2Text, gw2PlainText } from './Gw2Text';
import { useSettings } from '../lib/settings';
import { FilterBar, type FilterChange } from './FilterBar';

// Display mode of the result list; the choice is remembered in localStorage.
type Layout = 'table' | 'grid';
const LAYOUT_KEY = 'gw2items.layout';

// localStorage can be blocked (private mode etc.), so always use try/catch.
/** Reads the stored layout choice, default table. */
function loadLayout(): Layout {
    try {
        return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'table';
    } catch {
        return 'table';
    }
}

/** Persists the layout choice (ignores storage errors). */
function saveLayout(layout: Layout) {
    try {
        localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
        /* ignore */
    }
}

/** List page (route "/"): filter bar, result table or grid, export links and pagination. */
export function ItemListPage({ filters, onChange }: { filters: ListFilters; onChange: FilterChange }) {
    const { t, lang, formatNumber } = useT();
    const { settings, update: updateSettings } = useSettings();
    const [layout, setLayout] = useState<Layout>(loadLayout); // passing the function (not calling it) runs it only on the first render

    const query = toApiQuery(filters); // query string for the API, also used as part of the cache key
    // queryKey: results are cached per language and filter combination; changing either triggers a new request.
    const items = useQuery({
        queryKey: ['items', lang, query],
        queryFn: () => api.items(query, lang),
        placeholderData: keepPreviousData, // keep the old page until the new one is there
    });

    const changeLayout = (next: Layout) => {
        setLayout(next);
        saveLayout(next);
    };

    const data = items.data;
    return (
        <>
            <FilterBar filters={filters} onChange={onChange} />

            <div className="result-bar">
                <span className="muted" aria-live="polite">
                    {data ? t('list.items', { n: formatNumber(data.total) }) : items.isPending ? t('list.loading') : ''}
                    {items.isFetching && data && t('list.refreshing')}
                </span>
                <span className="small muted">
                    {t('list.export')}{' '}
                    {import.meta.env.VITE_DATA_MODE === 'static' ? (
                        // Pages version: the file is generated in the browser from the loaded data.
                        <>
                            <button
                                type="button"
                                className="link-button"
                                onClick={() => void downloadStaticExport(query, lang, 'csv')}
                                title={t('list.exportTitle')}
                            >
                                CSV
                            </button>
                            {' · '}
                            <button
                                type="button"
                                className="link-button"
                                onClick={() => void downloadStaticExport(query, lang, 'json')}
                                title={t('list.exportTitle')}
                            >
                                JSON
                            </button>
                        </>
                    ) : (
                        <>
                            <a href={exportUrl(filters, 'csv', lang)} download title={t('list.exportTitle')}>
                                CSV
                            </a>
                            {' · '}
                            <a href={exportUrl(filters, 'json', lang)} download title={t('list.exportTitle')}>
                                JSON
                            </a>
                        </>
                    )}
                </span>
                <div className="segmented" role="group" aria-label={t('list.layout')}>
                    <button
                        type="button"
                        className={layout === 'table' ? 'active' : ''}
                        aria-pressed={layout === 'table'}
                        onClick={() => changeLayout('table')}
                    >
                        {t('list.table')}
                    </button>
                    <button
                        type="button"
                        className={layout === 'grid' ? 'active' : ''}
                        aria-pressed={layout === 'grid'}
                        onClick={() => changeLayout('grid')}
                    >
                        {t('list.grid')}
                    </button>
                </div>
                {layout === 'table' && (
                    <label className="check small">
                        <input
                            type="checkbox"
                            checked={settings.showDescription}
                            onChange={(event) => updateSettings({ showDescription: event.target.checked })}
                        />
                        {t('list.showDescription')}
                    </label>
                )}
            </div>

            {items.isError && (
                <ErrorBox
                    message={t('list.loadError', { error: errorText(items.error, t) })}
                    onRetry={() => void items.refetch()}
                />
            )}
            {items.isPending && <Loading text={t('list.loadingItems')} />}
            {data && data.items.length === 0 && <p className="empty">{t('list.empty')}</p>}
            {data && data.items.length > 0 && (
                <div className={items.isPlaceholderData ? 'results stale' : 'results'}>
                    {layout === 'table' ? (
                        <ItemTable items={data.items} showDescription={settings.showDescription} />
                    ) : (
                        <ItemGrid items={data.items} />
                    )}
                </div>
            )}
            {data && (
                <Pagination
                    page={filters.page}
                    total={data.total}
                    pageSize={data.pageSize || PAGE_SIZE}
                    onPage={(page) => onChange({ page }, { keepPage: true })}
                />
            )}
        </>
    );
}

/** In-app link to the detail page of an item. */
function itemHref(item: ItemListItem) {
    return `/items/${item.id}`;
}

/** Tooltip with the English name when the view shows a different name (German). */
function nameTitle(item: ItemListItem) {
    return item.nameEn && item.nameEn !== item.name ? item.nameEn : undefined;
}

/** Item type with its subtype (e.g. Consumable · Food) in muted style. */
function TypeText({ item }: { item: ItemListItem }) {
    return (
        <>
            {item.type}
            {item.subtype && <span className="muted"> · {item.subtype}</span>}
        </>
    );
}

/** Result list as a table, one row per item. */
function ItemTable({ items, showDescription }: { items: ItemListItem[]; showDescription: boolean }) {
    const { t, lang } = useT();
    return (
        <table className="item-table">
            <thead>
                <tr>
                    <th className="col-icon" aria-label={t('col.icon')} />
                    <th>{t('col.name')}</th>
                    <th className="col-type">{t('col.type')}</th>
                    <th className="col-level">{t('col.level')}</th>
                    {showDescription && <th className="col-description">{t('col.description')}</th>}
                    <th>Game Types</th>
                    <th>{t('col.test')}</th>
                </tr>
            </thead>
            <tbody>
                {items.map((item) => (
                    <tr key={item.id} className={item.removed ? 'removed' : undefined}>
                        <td className="col-icon">
                            <ItemIcon icon={item.icon} rarity={item.rarity} name={item.name} size={36} />
                        </td>
                        <td>
                            <Link
                                href={itemHref(item)}
                                className={`item-name ${rarityClass(item.rarity)}`}
                                title={nameTitle(item)}
                            >
                                {item.name || `#${item.id}`}
                            </Link>
                            <div className="small muted">
                                {item.rarity} · #{item.id}
                                {item.removed && ` · ${t('list.removed')}`}
                                {item.name && (
                                    <>
                                        {' · '}
                                        <a
                                            href={wikiSearchUrl(lang, item.name)}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            className="wiki-link"
                                        >
                                            {t('list.wiki')}
                                        </a>
                                    </>
                                )}
                            </div>
                        </td>
                        <td className="col-type">
                            <TypeText item={item} />
                        </td>
                        <td className="col-level">{item.level}</td>
                        {showDescription && (
                            <td className="col-description">
                                {item.description && (
                                    // The clamp hides long texts, so the full text without markup is in the tooltip.
                                    <div className="description-clamp" title={gw2PlainText(item.description)}>
                                        <Gw2Text text={item.description} />
                                    </div>
                                )}
                            </td>
                        )}
                        <td>
                            <GameTypeBadges gameTypes={item.gameTypes} />
                        </td>
                        <td>
                            <TestBadge status={item.testStatus} needsRetest={item.needsRetest} />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** Result list as a card grid, one card per item. */
function ItemGrid({ items }: { items: ItemListItem[] }) {
    const { t } = useT();
    return (
        <ul className="item-grid">
            {items.map((item) => (
                <li key={item.id} className={item.removed ? 'removed' : undefined}>
                    <Link href={itemHref(item)} className="item-card">
                        <ItemIcon icon={item.icon} rarity={item.rarity} name={item.name} size={48} />
                        <span className="item-card-body">
                            <span className={`item-name ${rarityClass(item.rarity)}`} title={nameTitle(item)}>
                                {item.name || `#${item.id}`}
                            </span>
                            <span className="small muted">
                                <TypeText item={item} />
                                {item.removed && ` · ${t('list.removed')}`}
                            </span>
                            <GameTypeBadges gameTypes={item.gameTypes} />
                            <TestBadge status={item.testStatus} needsRetest={item.needsRetest} />
                        </span>
                    </Link>
                </li>
            ))}
        </ul>
    );
}

/** First/prev/next/last buttons with "page X of Y"; renders nothing when everything fits on one page. */
export function Pagination({
    page,
    total,
    pageSize,
    onPage,
}: {
    page: number;
    total: number;
    pageSize: number;
    onPage: (page: number) => void;
}) {
    const { t, formatNumber } = useT();
    // Total page count (at least 1).
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (pages <= 1) return null;
    return (
        <nav className="pagination" aria-label={t('page.aria')}>
            <button
                type="button"
                className="btn"
                disabled={page <= 1}
                onClick={() => onPage(1)}
                aria-label={t('page.first')}
            >
                «
            </button>
            <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
                {t('page.prev')}
            </button>
            <span className="muted">{t('page.of', { page: formatNumber(page), pages: formatNumber(pages) })}</span>
            <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
                {t('page.next')}
            </button>
            <button
                type="button"
                className="btn"
                disabled={page >= pages}
                onClick={() => onPage(pages)}
                aria-label={t('page.last')}
            >
                »
            </button>
        </nav>
    );
}
