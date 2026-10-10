import { useQuery } from '@tanstack/react-query';
import type { ItemView, Lang } from '../../../shared/types';
import { api } from '../api';
import { useT, type Key } from '../lib/i18n';
import { listUrl, type ListFilters } from '../lib/filters';
import { Link } from './common';
import { stateName } from '../lib/format';
import { UpdateButton } from './UpdateButton';

const TABS: { view: ItemView; label: Key }[] = [
  { view: 'gizmo', label: 'tab.gizmo' },
  { view: 'consumable', label: 'tab.consumable' },
  { view: 'tonic', label: 'tab.tonic' },
  { view: 'all', label: 'tab.all' },
];

const LANGS: Lang[] = ['en', 'de'];

/** Umschalter EN | DE. */
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

/** Kopfzeile mit Tabs, Kennzahlen und Update-Button. activeView ist null auf der Detailseite. */
export function Header({ filters, activeView, changesActive }: { filters: ListFilters; activeView: ItemView | null; changesActive: boolean }) {
  const { t, lang, formatDateTime, formatNumber } = useT();
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const s = stats.data;

  // Zähler am Tab "Änderungen": Einträge des neuesten abgeschlossenen Updates; beim Vollimport allein weglassen.
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
              <span title={t('header.lastUpdate')}>
                {t('header.updateLabel')} <strong>{s.lastUpdate ? `${stateName(s.lastUpdate)} UTC` : t('header.noUpdate')}</strong>
              </span>
            </>
          )}
        </div>
        <a href="/api/export" download className="small" title={t('header.exportTitle')}>
          {t('header.export')}
        </a>
        <UpdateButton />
        <LangSwitch />
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
      {/* Deutsche Texte kommen erst mit einem Update, das lang=de lädt. */}
      {lang === 'de' && s && s.items > 0 && s.germanTexts === 0 && <div className="lang-hint small">{t('header.germanHint')}</div>}
    </header>
  );
}
