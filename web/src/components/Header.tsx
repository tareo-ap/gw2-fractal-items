import { useQuery } from '@tanstack/react-query';
import type { ItemView, Lang } from '../../../shared/types';
import { api } from '../api';
import { useT, type Key } from '../lib/i18n';
import { listUrl, type ListFilters } from '../lib/filters';
import { Link } from './common';
import { stateName } from '../lib/format';
import { UpdateButton } from './UpdateButton';
import { SettingsMenu } from './SettingsMenu';

const TABS: { view: ItemView; label: Key }[] = [
  { view: 'gizmo', label: 'tab.gizmo' },
  { view: 'consumable', label: 'tab.consumable' },
  { view: 'tonic', label: 'tab.tonic' },
  { view: 'all', label: 'tab.all' },
];

const LANGS: Lang[] = ['en', 'de'];

/** EN | DE switch. */
function LangSwitch() {
  const { lang, setLang, t } = useT();
  return (
    <div className="segmented lang-switch" role="group" aria-label={t('lang.aria')}>
      {LANGS.map((l) => (
        <button key={l} type="button" className={l === lang ? 'active' : ''} aria-pressed={l === lang} lang={l} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Header with tabs, key figures and update button. activeView is null on the detail page. */
export function Header({ filters, activeView, changesActive }: { filters: ListFilters; activeView: ItemView | null; changesActive: boolean }) {
  const { t, lang, formatDateTime, formatNumber } = useT();
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const s = stats.data;

  // Counter on the "Changes" tab: entries of the latest completed update; omitted for the full import alone.
  const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });
  const latest = updates.data?.find((u) => u.status === undefined || u.status === 'done');
  const changesCount = latest && updates.data!.some((u) => u.id < latest.id) ? latest.added + latest.changed + latest.removed : null;

  const tabCount = (view: ItemView): number | null => {
    if (!s) return null;
    if (view === 'gizmo') return s.candidates.gizmo;
    if (view === 'consumable') return s.candidates.consumable;
    if (view === 'tonic') return s.candidates.tonic;
    return null;
  };

  return (
    <header className="app-header">
      <div className="header-top">
        <Link href="/" className="brand">
          GW2 Fractal Items
        </Link>
        <div className="header-stats small">
          {stats.isError && <span className="error">{t('header.statsUnavailable')}</span>}
          {s && (
            <>
              <span>
                <strong>{formatNumber(s.items)}</strong> Items
              </span>
              {import.meta.env.VITE_DATA_MODE === 'static' ? (
                // Pages version: only the data state, none of it can be changed.
                <span title={t('header.staticTitle')}>
                  {t('header.staticNote', { state: s.lastUpdate ? stateName(s.lastUpdate) : t('header.noUpdate') })}
                </span>
              ) : (
                <span title={t('header.lastUpdate')}>
                  {t('header.updateLabel')} <strong>{s.lastUpdate ? `${stateName(s.lastUpdate)} UTC` : t('header.noUpdate')}</strong>
                </span>
              )}
            </>
          )}
        </div>
        {/* Database export and update exist only in the local version (VITE_DATA_MODE=api). */}
        {import.meta.env.VITE_DATA_MODE !== 'static' && (
          <>
            <a href="/api/export" download className="small" title={t('header.exportTitle')}>
              {t('header.export')}
            </a>
            <UpdateButton />
          </>
        )}
        <LangSwitch />
        <SettingsMenu />
      </div>
      <nav className="tabs" aria-label={t('tabs.aria')}>
        {TABS.map((tab) => {
          const count = tabCount(tab.view);
          const href = listUrl({ ...filters, view: tab.view, page: 1 });
          return (
            <Link key={tab.view} href={href} className={tab.view === activeView ? 'tab active' : 'tab'}>
              {t(tab.label)}
              {count !== null && (
                <span className="tab-count" title={t('tab.candidatesTitle')}>
                  {formatNumber(count)}
                </span>
              )}
            </Link>
          );
        })}
        <Link href="/updates" className={changesActive ? 'tab active' : 'tab'}>
          {t('tab.changes')}
          {changesCount !== null && (
            <span className="tab-count" title={t('tab.changesTitle')}>
              {formatNumber(changesCount)}
            </span>
          )}
        </Link>
      </nav>
      {/* German texts only arrive with an update that loads lang=de. */}
      {lang === 'de' && s && s.items > 0 && s.germanTexts === 0 && <div className="lang-hint small">{t('header.germanHint')}</div>}
    </header>
  );
}
