import { useQuery } from '@tanstack/react-query';
import type { ItemView } from '../../../shared/types';
import { api } from '../api';
import { formatDateTime, formatNumber } from '../lib/format';
import { listUrl, type ListFilters } from '../lib/filters';
import { Link } from './common';
import { UpdateButton } from './UpdateButton';

const TABS: { view: ItemView; label: string }[] = [
  { view: 'gizmo', label: 'Gizmos' },
  { view: 'consumable', label: 'Consumables' },
  { view: 'all', label: 'Alle' },
];

/** Kopfzeile mit Tabs, Kennzahlen und Update-Button. activeView ist null auf der Detailseite. */
export function Header({ filters, activeView }: { filters: ListFilters; activeView: ItemView | null }) {
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const s = stats.data;

  const tabCount = (view: ItemView): number | null => {
    if (!s) return null;
    if (view === 'gizmo') return s.candidates.gizmo;
    if (view === 'consumable') return s.candidates.consumable;
    return null;
  };

  return (
    <header className="app-header">
      <div className="header-top">
        <Link href="/" className="brand">
          GW2 Fractal Items
        </Link>
        <div className="header-stats small">
          {stats.isError && <span className="error">Kennzahlen nicht verfügbar</span>}
          {s && (
            <>
              <span>
                <strong>{formatNumber(s.items)}</strong> Items
              </span>
              <span title="Letztes Update">
                Update: <strong>{s.lastUpdate ? formatDateTime(s.lastUpdate.startedAt) : 'noch keins'}</strong>
              </span>
            </>
          )}
        </div>
        <UpdateButton />
      </div>
      <nav className="tabs" aria-label="Ansicht">
        {TABS.map((tab) => {
          const count = tabCount(tab.view);
          const href = listUrl({ ...filters, view: tab.view, page: 1 });
          return (
            <Link key={tab.view} href={href} className={tab.view === activeView ? 'tab active' : 'tab'}>
              {tab.label}
              {count !== null && (
                <span className="tab-count" title="Fractal-Kandidaten">
                  {formatNumber(count)}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
