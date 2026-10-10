import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ChangeFocus, ChangeKind, ItemView, UpdateChangeEntry, UpdateCompareResponse, UpdateDetail } from '../../../shared/types';
import { api, ApiError } from '../api';
import { CHANGE_KINDS, changesUrl, compareUrl, parseChangesFilters, toChangesApiQuery, type ChangesFilters } from '../lib/changes';
import { describeUpdate, rarityClass, stateName } from '../lib/format';
import { errorText, useT, type TFunction } from '../lib/i18n';
import { PAGE_SIZE } from '../lib/filters';
import { navigate } from '../lib/router';
import { ErrorBox, GameTypeBadges, GameTypeDiff, ItemIcon, Link, Loading } from './common';
import { Gw2Text } from './Gw2Text';
import { Pagination } from './ItemListPage';

const FOCUSES: ChangeFocus[] = ['all', 'gameTypes', 'dungeonGained', 'dungeonLost'];
const TYPES: ItemView[] = ['gizmo', 'consumable', 'tonic', 'all'];

/** "/updates": springt auf das neueste abgeschlossene Update. */
export function UpdatesRedirect() {
  const { t } = useT();
  const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });
  const latest = updates.data?.find((u) => u.status === undefined || u.status === 'done');

  useEffect(() => {
    if (latest) navigate(changesUrl(latest.id), { replace: true });
  }, [latest]);

  if (updates.isError) {
    return <ErrorBox message={t('changes.updatesError', { error: errorText(updates.error, t) })} onRetry={() => void updates.refetch()} />;
  }
  if (updates.isPending || latest) return <Loading text={t('changes.loadingUpdates')} />;
  return (
    <div className="empty">
      <p>{t('changes.noUpdate')}</p>
    </div>
  );
}

function same<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** "/updates/compare?from=A&to=B": liest die beiden Update-IDs aus der URL. */
export function CompareRoute({ params }: { params: URLSearchParams }) {
  const { t } = useT();
  const from = Number(params.get('from'));
  const to = Number(params.get('to'));
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from >= to) {
    return (
      <div className="empty">
        <p>{t('changes.invalidCompare')}</p>
        <Link href="/updates">{t('changes.toLatest')}</Link>
      </div>
    );
  }
  return <UpdateChangesPage source={{ from, to }} params={params} />;
}

type Source = { id: number } | { from: number; to: number };
type Page = Omit<UpdateCompareResponse, 'from' | 'to'> & { from: UpdateDetail | null; to: UpdateDetail };

const isDone = (u: { status?: string }) => u.status === undefined || u.status === 'done';

/**
 * Änderungen: entweder eines Updates (/updates/:id, gegen den Vorgänger) oder zweier frei gewählter Stände
 * (/updates/compare). Zähler als Filter-Kacheln, Filterleiste und Liste.
 */
export function UpdateChangesPage({ source, params }: { source: Source; params: URLSearchParams }) {
  const i18n = useT();
  const { t, lang, formatNumber, formatDateTime } = i18n;
  const filters = parseChangesFilters(params);
  const query = toChangesApiQuery(filters);
  const changes = useQuery({
    queryKey: ['updateChanges', source, lang, query],
    queryFn: async (): Promise<Page> => {
      if ('from' in source) return api.compareUpdates(source.from, source.to, query, lang);
      const { update, ...rest } = await api.updateChanges(source.id, query, lang);
      return { ...rest, from: null, to: update };
    },
    placeholderData: keepPreviousData, // alte Seite stehen lassen, bis die neue da ist
  });
  const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });
  const toId = 'from' in source ? source.to : source.id;

  // Vorgänger für /updates/:id: das letzte abgeschlossene Update davor.
  const predecessor = 'from' in source ? undefined : updates.data?.find((u) => u.id < source.id && isDone(u));
  const fromId = 'from' in source ? source.from : predecessor?.id;
  const pageUrl = (f: ChangesFilters) => ('from' in source ? compareUrl(source.from, source.to, f) : changesUrl(source.id, f));

  // Jede Filteränderung springt auf Seite 1, außer beim Blättern selbst (patch.page).
  const change = (patch: Partial<ChangesFilters>, options: { replace?: boolean } = {}) =>
    navigate(pageUrl({ ...filters, page: 1, ...patch }), options);

  if (changes.isError && !changes.data) {
    const notFound = changes.error instanceof ApiError && changes.error.status === 404;
    return notFound ? (
      <div className="empty">
        <p>{t('changes.notFound')}</p>
        <Link href="/updates">{t('changes.toLatest')}</Link>
      </div>
    ) : (
      <ErrorBox message={t('changes.loadError', { error: errorText(changes.error, t) })} onRetry={() => void changes.refetch()} />
    );
  }
  if (!changes.data) return <Loading text={t('changes.loading')} />;

  const data = changes.data;
  const { to: update, counts } = data;
  // Das älteste Update ist der Vollimport: Dort ist alles neu, ein Vergleich lohnt erst ab dem zweiten.
  const isFirst = !('from' in source) && updates.data !== undefined && updates.data.every((u) => u.id >= update.id);
  const fromUpdate = data.from ?? predecessor ?? null;
  const doneUpdates = (updates.data ?? []).filter(isDone);

  const kindTile = (kind: ChangeKind, count: number, className: string) => ({
    label: t(`change.${kind}`),
    count,
    patch: { kind: [kind], focus: 'all' } as Partial<ChangesFilters>,
    active: same(filters.kind, [kind]) && filters.focus === 'all',
    className,
  });
  const focusTile = (focus: ChangeFocus, count: number, className = '') => ({
    label: t(`focus.${focus}`),
    count,
    patch: { kind: [], focus } as Partial<ChangesFilters>,
    active: filters.focus === focus,
    className,
  });
  const tiles = [
    kindTile('added', counts.added, 'change-added'),
    kindTile('changed', counts.changed, 'change-changed'),
    kindTile('removed', counts.removed, 'change-removed'),
    focusTile('gameTypes', counts.gameTypesChanged),
    focusTile('dungeonGained', counts.dungeonGained, 'change-added'),
    focusTile('dungeonLost', counts.dungeonLost, 'change-removed'),
  ];

  // Reihenfolge wie in CHANGE_KINDS halten, damit die URL stabil bleibt.
  const toggleKind = (kind: ChangeKind) =>
    change({ kind: CHANGE_KINDS.filter((k) => (k === kind ? !filters.kind.includes(k) : filters.kind.includes(k))) });

  return (
    <>
      <div className="panel update-head">
        <div>
          <h2>{'from' in source ? t('changes.titleCompare', { from: source.from, to: update.id }) : t('changes.titleUpdate', { id: update.id })}</h2>
          <div className="small muted">
            {t('changes.stateName', { name: stateName(update) })} · {t('changes.build', { build: update.buildId ?? t('changes.unknownBuild') })} ·{' '}
            {update.status === 'done' ? t('changes.statusDone') : update.status === 'running' ? t('changes.statusRunning') : t('changes.statusFailed')}
          </div>
        </div>
        <label className="field field-update">
          <span className="field-label">{t('changes.from')}</span>
          <select
            value={fromId ?? ''}
            disabled={fromId === undefined}
            onChange={(e) => navigate(compareUrl(Number(e.target.value), toId, { ...filters, page: 1 }))}
          >
            {fromId === undefined && <option value="">–</option>}
            {doneUpdates.filter((u) => u.id < toId).map((u) => (
              <option key={u.id} value={u.id}>
                {describeUpdate(u, i18n)}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-update">
          <span className="field-label">{t('changes.to')}</span>
          <select
            value={toId}
            disabled={fromId === undefined}
            onChange={(e) => navigate(compareUrl(fromId!, Number(e.target.value), { ...filters, page: 1 }))}
          >
            {doneUpdates.filter((u) => u.id > (fromId ?? 0) || u.id === toId).map((u) => (
              <option key={u.id} value={u.id}>
                {describeUpdate(u, i18n)}
              </option>
            ))}
            {!doneUpdates.some((u) => u.id === toId) && <option value={toId}>{t('filter.updateN', { id: toId })}</option>}
          </select>
        </label>
      </div>

      {update.status === 'failed' && (
        <div className="warning">{update.error ? t('changes.failedWithError', { error: update.error }) : t('changes.failed')}</div>
      )}
      {data.legacyValues && (
        <div className="warning">
          {'from' in source ? t('changes.legacyRange') : t('changes.legacyUpdate')}
        </div>
      )}
      {isFirst && (
        <div className="warning">
          {t('changes.first')}
        </div>
      )}

      <div className="count-tiles">
        {tiles.map((tile) => (
          <Link key={tile.label} href={pageUrl({ ...filters, ...tile.patch, page: 1 })} className={tile.active ? 'count-tile active' : 'count-tile'}>
            <span className={`count-tile-value ${tile.count > 0 ? tile.className : 'muted'}`}>{formatNumber(tile.count)}</span>
            <span className="small muted">{tile.label}</span>
          </Link>
        ))}
      </div>

      <section className="filters" aria-label={t('changes.filterAria')}>
        <div className="filter-row">
          <fieldset className="chip-group">
            <legend className="field-label">{t('changes.kind')}</legend>
            {CHANGE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`chip ${filters.kind.includes(kind) ? 'selected' : ''}`}
                aria-pressed={filters.kind.includes(kind)}
                onClick={() => toggleKind(kind)}
              >
                {t(`change.${kind}`)}
              </button>
            ))}
          </fieldset>
          <div className="field">
            <span className="field-label">{t('changes.focus')}</span>
            <div className="segmented" role="group" aria-label={t('changes.focus')}>
              {FOCUSES.map((focus) => (
                <button key={focus} type="button" className={filters.focus === focus ? 'active' : ''} aria-pressed={filters.focus === focus} onClick={() => change({ focus })}>
                  {t(`focus.${focus}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('changes.type')}</span>
            <div className="segmented" role="group" aria-label={t('changes.type')}>
              {TYPES.map((type) => (
                <button key={type} type="button" className={filters.type === type ? 'active' : ''} aria-pressed={filters.type === type} onClick={() => change({ type })}>
                  {t(`type.${type}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="filter-row changes-search">
          <label className="field field-search">
            <span className="field-label">{t('changes.search')}</span>
            <input
              type="search"
              key={`${toId}-${filters.q}`}
              defaultValue={filters.q}
              onChange={(e) => change({ q: e.target.value }, { replace: true })}
              placeholder={t('changes.searchPlaceholder')}
              autoComplete="off"
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={filters.hidePlaceholders} onChange={(e) => change({ hidePlaceholders: e.target.checked })} />
            {t('changes.hidePlaceholders')}
          </label>
        </div>
      </section>

      <div className="result-bar">
        <span className="muted" aria-live="polite">
          {t('changes.entries', { n: formatNumber(data.total) })}
          {changes.isFetching && t('changes.refreshing')}
        </span>
      </div>

      {data.items.length === 0 ? (
        <p className="empty">{t('changes.noResults')}</p>
      ) : (
        <div className={changes.isPlaceholderData ? 'results stale' : 'results'}>
          <ChangesTable
            items={data.items}
            oldLabel={fromUpdate ? t('changes.stateAfter', { id: fromUpdate.id, date: stateName(fromUpdate) }) : t('changes.beforeImport')}
            newLabel={t('changes.stateAfter', { id: update.id, date: stateName(update) })}
          />
        </div>
      )}
      <Pagination page={filters.page} total={data.total} pageSize={data.pageSize || PAGE_SIZE} onPage={(page) => change({ page })} />
    </>
  );
}

const MAX_TEXT = 160;

interface FieldRowData {
  name: string;
  before?: ReactNode; // fehlt = Zelle wird von "message" überspannt
  after?: ReactNode;
  message?: string;
}

const Missing = ({ text }: { text: string }) => <span className="muted">{text}</span>;

/** Zeilen eines Eintrags: game_types immer zuerst, danach die übrigen Felder in API-Reihenfolge. */
function buildRows(item: UpdateChangeEntry, t: TFunction): FieldRowData[] {
  const rows: FieldRowData[] = [];
  const notStored = t('changes.notStored');
  const didNotExist = t('changes.didNotExist');
  const removedText = t('changes.removedValue');
  const absent = t('changes.absent');
  const { kind } = item;

  if ((kind !== 'changed' || item.changedFields.includes('game_types')) && (item.gameTypesBefore || item.gameTypesAfter)) {
    rows.push({
      name: 'game_types',
      before: kind === 'added' ? <Missing text={didNotExist} /> : <GameTypeBadges gameTypes={item.gameTypesBefore ?? []} />,
      after:
        kind === 'removed' ? (
          <Missing text={removedText} />
        ) : (
          <>
            <GameTypeBadges gameTypes={item.gameTypesAfter ?? []} />
            {kind === 'changed' && <GameTypeDiff before={item.gameTypesBefore ?? []} after={item.gameTypesAfter ?? []} />}
          </>
        ),
    });
  }

  if (kind === 'changed' && item.before === null) {
    const others = item.changedFields.filter((n) => n !== 'game_types');
    if (others.length > 0) rows.push({ name: others.join(', '), message: notStored });
    return rows;
  }

  const names = kind === 'changed' ? item.changedFields : Object.keys((kind === 'added' ? item.after : item.before) ?? {});
  for (const name of names.filter((n) => n !== 'game_types')) {
    if (item.unknownFields?.includes(name)) {
      rows.push({ name, message: notStored });
      continue;
    }
    const before = item.before?.[name];
    const after = item.after?.[name];
    rows.push({
      name,
      before: kind === 'added' ? <Missing text={didNotExist} /> : before === undefined ? <Missing text={absent} /> : <ValueView value={before} />,
      after: kind === 'removed' ? <Missing text={removedText} /> : after === undefined ? <Missing text={absent} /> : <ValueView value={after} />,
    });
  }
  return rows;
}

function ChangesTable({ items, oldLabel, newLabel }: { items: UpdateChangeEntry[]; oldLabel: string; newLabel: string }) {
  const { t } = useT();
  return (
    <table className="item-table changes-table">
      <thead>
        <tr>
          <th>{t('changes.colItem')}</th>
          <th>{t('changes.colField')}</th>
          <th>{oldLabel}</th>
          <th>{newLabel}</th>
        </tr>
      </thead>
      {items.map((item) => (
        <ChangeRows key={`${item.id}-${item.kind}`} item={item} oldLabel={oldLabel} newLabel={newLabel} />
      ))}
    </table>
  );
}

/** Ein Eintrag als eigener tbody: Item-Zelle mit rowspan, dazu eine Zeile pro geändertem Feld. */
function ChangeRows({ item, oldLabel, newLabel }: { item: UpdateChangeEntry; oldLabel: string; newLabel: string }) {
  const { t } = useT();
  const dungeonChanged = (item.gameTypesBefore?.includes('Dungeon') ?? false) !== (item.gameTypesAfter?.includes('Dungeon') ?? false);
  const classes = [item.kind === 'changed' && dungeonChanged ? 'dungeon-change' : '', item.removed ? 'removed' : ''].filter(Boolean).join(' ');
  const rows = buildRows(item, t);

  const itemCell = (
    <td rowSpan={Math.max(rows.length, 1)} className="item-cell">
      <div className="item-cell-body">
        <ItemIcon icon={item.icon} rarity={item.rarity} name={item.name} size={36} />
        <div>
          <Link href={`/items/${item.id}`} className={`item-name ${rarityClass(item.rarity)}`}>
            {item.name || `#${item.id}`}
          </Link>
          {/* In der deutschen Ansicht steht der englische Name klein darunter (Alt/Neu sind englisch). */}
          {item.nameEn !== item.name && <div className="small muted">{item.nameEn}</div>}
          <div className="small muted">
            {item.type}
            {item.subtype && ` · ${item.subtype}`} · #{item.id}
          </div>
          <span className={`badge change-${item.kind}`}>{t(`change.${item.kind}`)}</span>
        </div>
      </div>
    </td>
  );

  return (
    <tbody className={classes || undefined}>
      {rows.length === 0 && (
        <tr>
          {itemCell}
          <td colSpan={3} className="small muted">
            {t('changes.noFieldChange')}
          </td>
        </tr>
      )}
      {rows.map((row, i) => (
        <tr key={row.name} className="field-row">
          {i === 0 && itemCell}
          <td className="field-name small">
            <code>{row.name}</code>
          </td>
          {row.message ? (
            <td colSpan={2} className="small muted">
              {row.message}
            </td>
          ) : (
            <>
              <td className="value-cell" data-label={oldLabel}>
                {row.before}
              </td>
              <td className="value-cell" data-label={newLabel}>
                {row.after}
              </td>
            </>
          )}
        </tr>
      ))}
    </tbody>
  );
}

/** Wert eines Feldes lesbar: Text mit GW2-Markup, Arrays als Chips, Objekte als "Schlüssel: Wert". */
function ValueView({ value }: { value: unknown }) {
  const { t } = useT();
  if (typeof value === 'string') return <LongText text={value} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">{t('common.empty')}</span>;
    return (
      <span className="badges">
        {value.map((v, i) => (
          <span key={i} className="badge">
            {typeof v === 'string' ? v : JSON.stringify(v)}
          </span>
        ))}
      </span>
    );
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="muted">{t('common.empty')}</span>;
    return (
      <dl className="kv">
        {entries.map(([key, v]) => (
          <div key={key}>
            <dt className="muted">{key}:</dt> <dd>{typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{value === null ? 'null' : String(value)}</span>;
}

/** Lange Texte gekürzt (ohne GW2-Markup), per Klick vollständig mit Markup. */
function LongText({ text }: { text: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (text === '') return <span className="muted">{t('common.empty')}</span>;
  if (text.length <= MAX_TEXT) return <Gw2Text text={text} />;
  return (
    <>
      {open ? <Gw2Text text={text} /> : <span>{text.replace(/<[^>]*>/g, '').slice(0, MAX_TEXT)} …</span>}{' '}
      <button type="button" className="link-button small" onClick={() => setOpen(!open)}>
        {open ? t('value.less') : t('value.more')}
      </button>
    </>
  );
}
