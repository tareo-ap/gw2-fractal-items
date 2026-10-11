import { useQuery } from '@tanstack/react-query';
import type { ItemView, Lang } from '../../../shared/types';
import { api } from '../api';
import { useT, type Key } from '../lib/i18n';
import { listUrl, type ListFilters } from '../lib/filters';
import { Link } from './common';
import { stateName } from '../lib/format';
import { UpdateButton } from './UpdateButton';
import { SettingsMenu } from './SettingsMenu';

// Tab definitions; `label` is a typed i18n key (Key = union of all keys in i18n.ts, so typos fail to compile).
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
            {LANGS.map((langCode) => (
                <button
                    key={langCode}
                    type="button"
                    className={langCode === lang ? 'active' : ''}
                    aria-pressed={langCode === lang}
                    lang={langCode}
                    onClick={() => setLang(langCode)}
                >
                    {langCode.toUpperCase()}
                </button>
            ))}
        </div>
    );
}

/** Header with tabs, key figures and update button. activeView is null on the detail page. */
export function Header({
    filters,
    activeView,
    changesActive,
}: {
    filters: ListFilters;
    activeView: ItemView | null;
    changesActive: boolean;
}) {
    const { t, lang, formatDateTime, formatNumber } = useT();
    // useQuery (TanStack Query) fetches data and caches it under queryKey; queries with the same key share one result.
    // It returns { data, isError, isLoading, ... } and re-renders the component when they change.
    const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
    const statsData = stats.data;

    // Counter on the "Changes" tab: entries of the latest completed update; omitted for the full import alone.
    const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });
    const latest = updates.data?.find((update) => update.status === undefined || update.status === 'done');
    const changesCount =
        latest && updates.data!.some((update) => update.id < latest.id)
            ? latest.added + latest.changed + latest.removed
            : null;

    // Candidate count shown on a tab (only for the three item tabs).
    const tabCount = (view: ItemView): number | null => {
        if (!statsData) return null;
        if (view === 'gizmo') return statsData.candidates.gizmo;
        if (view === 'consumable') return statsData.candidates.consumable;
        if (view === 'tonic') return statsData.candidates.tonic;
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
                    {statsData && (
                        <>
                            <span>
                                <strong>{formatNumber(statsData.items)}</strong> Items
                            </span>
                            {import.meta.env.VITE_DATA_MODE === 'static' ? (
                                // Pages version: only the data state, none of it can be changed.
                                <span title={t('header.staticTitle')}>
                                    {t('header.staticNote', {
                                        state: statsData.lastUpdate
                                            ? stateName(statsData.lastUpdate)
                                            : t('header.noUpdate'),
                                    })}
                                </span>
                            ) : (
                                <span title={t('header.lastUpdate')}>
                                    {t('header.updateLabel')}{' '}
                                    <strong>
                                        {statsData.lastUpdate
                                            ? `${stateName(statsData.lastUpdate)} UTC`
                                            : t('header.noUpdate')}
                                    </strong>
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
            {lang === 'de' && statsData && statsData.items > 0 && statsData.germanTexts === 0 && (
                <div className="lang-hint small">{t('header.germanHint')}</div>
            )}
        </header>
    );
}
