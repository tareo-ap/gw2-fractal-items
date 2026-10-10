import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ItemListItem } from '../../../shared/types';
import { api } from '../api';
import { formatNumber, rarityClass } from '../lib/format';
import { PAGE_SIZE, toApiQuery, type ListFilters } from '../lib/filters';
import { ErrorBox, GameTypeBadges, ItemIcon, Link, Loading, TestBadge } from './common';
import { FilterBar, type FilterChange } from './FilterBar';

type Layout = 'table' | 'grid';
const LAYOUT_KEY = 'gw2items.layout';

// localStorage kann gesperrt sein (privater Modus o. ä.), daher immer mit try/catch.
function loadLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'table';
  } catch {
    return 'table';
  }
}

function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    /* egal */
  }
}

export function ItemListPage({ filters, onChange }: { filters: ListFilters; onChange: FilterChange }) {
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const query = toApiQuery(filters);
  const items = useQuery({
    queryKey: ['items', query],
    queryFn: () => api.items(query),
    placeholderData: keepPreviousData, // alte Seite stehen lassen, bis die neue da ist
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
          {data ? `${formatNumber(data.total)} Items` : items.isPending ? 'Lade …' : ''}
          {items.isFetching && data && ' · aktualisiere …'}
        </span>
        <div className="segmented" role="group" aria-label="Darstellung">
          <button type="button" className={layout === 'table' ? 'active' : ''} aria-pressed={layout === 'table'} onClick={() => changeLayout('table')}>
            Tabelle
          </button>
          <button type="button" className={layout === 'grid' ? 'active' : ''} aria-pressed={layout === 'grid'} onClick={() => changeLayout('grid')}>
            Kacheln
          </button>
        </div>
      </div>

      {items.isError && <ErrorBox message={`Items konnten nicht geladen werden: ${items.error.message}`} onRetry={() => void items.refetch()} />}
      {items.isPending && <Loading text="Lade Items …" />}
      {data && data.items.length === 0 && <p className="empty">Keine Items gefunden. Filter anpassen oder Suche ändern.</p>}
      {data && data.items.length > 0 && (
        <div className={items.isPlaceholderData ? 'results stale' : 'results'}>
          {layout === 'table' ? <ItemTable items={data.items} /> : <ItemGrid items={data.items} />}
        </div>
      )}
      {data && <Pagination page={filters.page} total={data.total} pageSize={data.pageSize || PAGE_SIZE} onPage={(page) => onChange({ page }, { keepPage: true })} />}
    </>
  );
}

function itemHref(item: ItemListItem) {
  return `/items/${item.id}`;
}

function TypeText({ item }: { item: ItemListItem }) {
  return (
    <>
      {item.type}
      {item.subtype && <span className="muted"> · {item.subtype}</span>}
    </>
  );
}

function ItemTable({ items }: { items: ItemListItem[] }) {
  return (
    <table className="item-table">
      <thead>
        <tr>
          <th className="col-icon" aria-label="Icon" />
          <th>Name</th>
          <th className="col-type">Typ</th>
          <th className="col-level">Level</th>
          <th>Game Types</th>
          <th>Test</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className={item.removed ? 'removed' : undefined}>
            <td className="col-icon">
              <ItemIcon icon={item.icon} rarity={item.rarity} name={item.name} size={36} />
            </td>
            <td>
              <Link href={itemHref(item)} className={`item-name ${rarityClass(item.rarity)}`}>
                {item.name || `#${item.id}`}
              </Link>
              <div className="small muted">
                {item.rarity} · #{item.id}
                {item.removed && ' · entfernt'}
              </div>
            </td>
            <td className="col-type">
              <TypeText item={item} />
            </td>
            <td className="col-level">{item.level}</td>
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

function ItemGrid({ items }: { items: ItemListItem[] }) {
  return (
    <ul className="item-grid">
      {items.map((item) => (
        <li key={item.id} className={item.removed ? 'removed' : undefined}>
          <Link href={itemHref(item)} className="item-card">
            <ItemIcon icon={item.icon} rarity={item.rarity} name={item.name} size={48} />
            <span className="item-card-body">
              <span className={`item-name ${rarityClass(item.rarity)}`}>{item.name || `#${item.id}`}</span>
              <span className="small muted">
                <TypeText item={item} />
                {item.removed && ' · entfernt'}
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

export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Seiten">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(1)} aria-label="Erste Seite">
        «
      </button>
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Zurück
      </button>
      <span className="muted">
        Seite {formatNumber(page)} von {formatNumber(pages)}
      </span>
      <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Weiter
      </button>
      <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(pages)} aria-label="Letzte Seite">
        »
      </button>
    </nav>
  );
}
