import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    ChangeFocus,
    ChangeKind,
    ItemView,
    UpdateChangeEntry,
    UpdateCompareResponse,
    UpdateDetail,
} from '../../../shared/types';
import { api, ApiError, type UpdateListEntry } from '../api';
import {
    CHANGE_KINDS,
    changesUrl,
    compareUrl,
    parseChangesFilters,
    toChangesApiQuery,
    type ChangesFilters,
} from '../lib/changes';
import { describeUpdate, rarityClass, stateName } from '../lib/format';
import { errorText, useT, type Key, type TFunction } from '../lib/i18n';
import { PAGE_SIZE } from '../lib/filters';
import { navigate } from '../lib/router';
import { ErrorBox, GameTypeBadges, GameTypeDiff, ItemIcon, Link, Loading } from './common';
import { Gw2Text } from './Gw2Text';
import { Pagination } from './ItemListPage';

// Same lists as in lib/changes.ts / lib/filters.ts, used for the filter buttons below.
const FOCUSES: ChangeFocus[] = ['all', 'gameTypes', 'dungeonGained', 'dungeonLost'];
const TYPES: ItemView[] = ['gizmo', 'consumable', 'tonic', 'all'];

/** "/updates": jumps to the latest completed update. */
export function UpdatesRedirect() {
    const { t } = useT();
    const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });
    // Latest completed update; `status` is missing in older API responses, which counts as done.
    const latest = updates.data?.find(
        (updateEntry) => updateEntry.status === undefined || updateEntry.status === 'done',
    );

    // Redirect as a side effect after render (navigating during render would be a React error).
    useEffect(() => {
        if (latest) navigate(changesUrl(latest.id), { replace: true });
    }, [latest]);

    if (updates.isError) {
        return (
            <ErrorBox
                message={t('changes.updatesError', { error: errorText(updates.error, t) })}
                onRetry={() => void updates.refetch()}
            />
        );
    }
    if (updates.isPending || latest) return <Loading text={t('changes.loadingUpdates')} />;
    return (
        <>
            <div className="empty">
                <p>{t('changes.noUpdate')}</p>
            </div>
            {import.meta.env.VITE_DATA_MODE !== 'static' && <ManageStates updates={updates.data ?? []} shownIds={[]} />}
        </>
    );
}

/**
 * "Manage states" section: all update runs with a delete button. Whether a state can be deleted is decided by the
 * server
 * (deletable / deleteBlockedReason); non-deletable ones have a disabled button with the reason as tooltip.
 * shownIds: states currently displayed; if one is deleted, navigate back to /updates.
 */
function ManageStates({ updates, shownIds }: { updates: UpdateListEntry[]; shownIds: number[] }) {
    const i18n = useT();
    const { t } = i18n;
    const queryClient = useQueryClient();
    const [error, setError] = useState<string | null>(null);

    // useMutation = write request, triggered with remove.mutate(id). onSuccess receives (result, variables).
    const remove = useMutation({
        mutationFn: api.deleteUpdate,
        onMutate: () => setError(null),
        onSuccess: (_data, id) => {
            // Mark all cached reads that may now be outdated as stale so they are re-fetched.
            for (const key of ['updates', 'stats', 'updateChanges', 'items', 'item']) {
                void queryClient.invalidateQueries({ queryKey: [key] });
            }
            if (shownIds.includes(id)) navigate('/updates', { replace: true });
        },
        onError: (err: Error) => setError(t('manage.error', { error: errorText(err, t) })),
    });

    if (updates.length === 0) return null;
    // Native confirm dialog before the irreversible delete.
    const confirmDelete = (updateEntry: UpdateListEntry) => {
        if (window.confirm(t('manage.confirm', { name: stateName(updateEntry) }))) remove.mutate(updateEntry.id);
    };

    return (
        <details className="manage-states">
            <summary>{t('manage.title')}</summary>
            <p className="small muted">{t('manage.hint')}</p>
            {error && (
                <div className="error small" role="alert">
                    {error}
                </div>
            )}
            <ul className="state-list">
                {/* One row per stored state (update run). */}
                {updates.map((updateEntry) => {
                    const blocked = updateEntry.deleteBlockedReason
                        ? t(`manage.blocked.${updateEntry.deleteBlockedReason}` as Key)
                        : undefined;
                    const failed = updateEntry.status === 'failed';
                    const empty = updateEntry.added + updateEntry.changed + updateEntry.removed === 0;
                    return (
                        <li key={updateEntry.id} className="state-row">
                            <span className="state-name">
                                {updateEntry.status === 'running' || failed ? (
                                    describeUpdate(updateEntry, i18n)
                                ) : (
                                    <Link href={changesUrl(updateEntry.id)}>{stateName(updateEntry)}</Link>
                                )}
                                <span className="small muted"> · #{updateEntry.id}</span>
                            </span>
                            <span className="small muted">
                                {updateEntry.status === 'running'
                                    ? t('changes.statusRunning')
                                    : failed
                                      ? t('changes.statusFailed')
                                      : t('changes.statusDone')}
                                {!failed && updateEntry.status !== 'running' && (
                                    <>
                                        {' · '}
                                        {empty
                                            ? t('manage.noChanges')
                                            : `${t('update.describeNew', { n: i18n.formatNumber(updateEntry.added) })}, ${t('update.describeChanged', { n: i18n.formatNumber(updateEntry.changed) })}, ${t('update.describeRemoved', { n: i18n.formatNumber(updateEntry.removed) })}`}
                                    </>
                                )}
                            </span>
                            <button
                                type="button"
                                className="btn btn-small btn-danger"
                                disabled={!updateEntry.deletable || remove.isPending}
                                title={blocked}
                                onClick={() => confirmDelete(updateEntry)}
                            >
                                {t('manage.delete')}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </details>
    );
}

// Element-wise equality of two arrays (generic <T>: works for any element type).
function same<T>(first: T[], second: T[]): boolean {
    return first.length === second.length && first.every((value, index) => value === second[index]);
}

/** "/updates/compare?from=A&to=B": reads the two update IDs from the URL. */
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

// Where the changes come from: one update (compared to its predecessor) or two chosen states.
// A union type: `'from' in source` below tells the variants apart (type narrowing).
type Source = { id: number } | { from: number; to: number };
// API response, unified for both sources. Omit<T, K> = T without key K; `from` is null for a single update.
type Page = Omit<UpdateCompareResponse, 'from' | 'to'> & { from: UpdateDetail | null; to: UpdateDetail };

// Done = completed update; `status` may be missing in older responses, which counts as done.
const isDone = (updateEntry: { status?: string }) => updateEntry.status === undefined || updateEntry.status === 'done';

/**
 * Changes: either of one update (/updates/:id, against its predecessor) or of two freely chosen states
 * (/updates/compare). Counters as filter tiles, filter bar and list.
 */
export function UpdateChangesPage({ source, params }: { source: Source; params: URLSearchParams }) {
    const i18n = useT();
    const { t, lang, formatNumber, formatDateTime } = i18n;
    const filters = parseChangesFilters(params);
    const query = toChangesApiQuery(filters);
    // queryKey contains everything the result depends on, so a change of source, language or filters re-fetches.
    // placeholderData: keepPreviousData shows the previous page (dimmed) while the next one loads.
    const changes = useQuery({
        queryKey: ['updateChanges', source, lang, query],
        queryFn: async (): Promise<Page> => {
            if ('from' in source) return api.compareUpdates(source.from, source.to, query, lang);
            // Object rest: `rest` = all properties except `update`; reshaped to the same Page type as the compare
            // response.
            const { update, ...rest } = await api.updateChanges(source.id, query, lang);
            return { ...rest, from: null, to: update };
        },
        placeholderData: keepPreviousData, // keep the old page until the new one is there
    });
    const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });
    // Id of the newer state (the "to" side).
    const toId = 'from' in source ? source.to : source.id;

    // Predecessor for /updates/:id: the last completed update before it.
    const predecessor =
        'from' in source
            ? undefined
            : updates.data?.find((updateEntry) => updateEntry.id < source.id && isDone(updateEntry));
    const fromId = 'from' in source ? source.from : predecessor?.id;
    // URL of this same page with other filters.
    const pageUrl = (pageFilters: ChangesFilters) =>
        'from' in source ? compareUrl(source.from, source.to, pageFilters) : changesUrl(source.id, pageFilters);

    // Every filter change jumps to page 1, except when paging itself (patch.page).
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
            <ErrorBox
                message={t('changes.loadError', { error: errorText(changes.error, t) })}
                onRetry={() => void changes.refetch()}
            />
        );
    }
    if (!changes.data) return <Loading text={t('changes.loading')} />;

    const data = changes.data;
    const { to: update, counts } = data;
    // The oldest update is the full import: everything is new there, a comparison is only worthwhile from the second.
    const isFirst =
        !('from' in source) &&
        updates.data !== undefined &&
        updates.data.every((updateEntry) => updateEntry.id >= update.id);
    const fromUpdate = data.from ?? predecessor ?? null;
    const doneUpdates = (updates.data ?? []).filter(isDone);

    // Clickable count tiles above the list; clicking one sets the matching filter. `as Partial<...>` is a type
    // assertion needed because the literals would otherwise be widened to string.
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
    // Tile order as displayed.
    const tiles = [
        kindTile('added', counts.added, 'change-added'),
        kindTile('changed', counts.changed, 'change-changed'),
        kindTile('removed', counts.removed, 'change-removed'),
        focusTile('gameTypes', counts.gameTypesChanged),
        focusTile('dungeonGained', counts.dungeonGained, 'change-added'),
        focusTile('dungeonLost', counts.dungeonLost, 'change-removed'),
    ];

    // Keep the order as in CHANGE_KINDS so the URL stays stable.
    const toggleKind = (kind: ChangeKind) =>
        change({
            kind: CHANGE_KINDS.filter((candidateKind) =>
                candidateKind === kind ? !filters.kind.includes(candidateKind) : filters.kind.includes(candidateKind),
            ),
        });

    return (
        <>
            <div className="panel update-head">
                <div>
                    <h2>
                        {'from' in source
                            ? t('changes.titleCompare', { from: source.from, to: update.id })
                            : t('changes.titleUpdate', { id: update.id })}
                    </h2>
                    <div className="small muted">
                        {t('changes.stateName', { name: stateName(update) })} ·{' '}
                        {t('changes.build', { build: update.buildId ?? t('changes.unknownBuild') })} ·{' '}
                        {update.status === 'done'
                            ? t('changes.statusDone')
                            : update.status === 'running'
                              ? t('changes.statusRunning')
                              : t('changes.statusFailed')}
                    </div>
                </div>
                <label className="field field-update">
                    <span className="field-label">{t('changes.from')}</span>
                    <select
                        value={fromId ?? ''}
                        disabled={fromId === undefined}
                        onChange={(event) =>
                            navigate(compareUrl(Number(event.target.value), toId, { ...filters, page: 1 }))
                        }
                    >
                        {fromId === undefined && <option value="">–</option>}
                        {doneUpdates
                            .filter((updateEntry) => updateEntry.id < toId)
                            .map((updateEntry) => (
                                <option key={updateEntry.id} value={updateEntry.id}>
                                    {describeUpdate(updateEntry, i18n)}
                                </option>
                            ))}
                    </select>
                </label>
                <label className="field field-update">
                    <span className="field-label">{t('changes.to')}</span>
                    <select
                        value={toId}
                        disabled={fromId === undefined}
                        onChange={(event) =>
                            navigate(compareUrl(fromId!, Number(event.target.value), { ...filters, page: 1 }))
                        }
                    >
                        {doneUpdates
                            .filter((updateEntry) => updateEntry.id > (fromId ?? 0) || updateEntry.id === toId)
                            .map((updateEntry) => (
                                <option key={updateEntry.id} value={updateEntry.id}>
                                    {describeUpdate(updateEntry, i18n)}
                                </option>
                            ))}
                        {!doneUpdates.some((updateEntry) => updateEntry.id === toId) && (
                            <option value={toId}>{t('filter.updateN', { id: toId })}</option>
                        )}
                    </select>
                </label>
            </div>

            {update.status === 'failed' && (
                <div className="warning">
                    {update.error ? t('changes.failedWithError', { error: update.error }) : t('changes.failed')}
                </div>
            )}
            {data.legacyValues && (
                <div className="warning">{'from' in source ? t('changes.legacyRange') : t('changes.legacyUpdate')}</div>
            )}
            {isFirst && (
                <div className="warning">
                    {t('changes.first')}
                    {import.meta.env.VITE_DATA_MODE === 'static' && ` ${t('changes.firstStatic')}`}
                </div>
            )}

            <div className="count-tiles">
                {tiles.map((tile) => (
                    <Link
                        key={tile.label}
                        href={pageUrl({ ...filters, ...tile.patch, page: 1 })}
                        className={tile.active ? 'count-tile active' : 'count-tile'}
                    >
                        <span className={`count-tile-value ${tile.count > 0 ? tile.className : 'muted'}`}>
                            {formatNumber(tile.count)}
                        </span>
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
                                <button
                                    key={focus}
                                    type="button"
                                    className={filters.focus === focus ? 'active' : ''}
                                    aria-pressed={filters.focus === focus}
                                    onClick={() => change({ focus })}
                                >
                                    {t(`focus.${focus}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="field">
                        <span className="field-label">{t('changes.type')}</span>
                        <div className="segmented" role="group" aria-label={t('changes.type')}>
                            {TYPES.map((type) => (
                                <button
                                    key={type}
                                    type="button"
                                    className={filters.type === type ? 'active' : ''}
                                    aria-pressed={filters.type === type}
                                    onClick={() => change({ type })}
                                >
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
                            onChange={(event) => change({ q: event.target.value }, { replace: true })}
                            placeholder={t('changes.searchPlaceholder')}
                            autoComplete="off"
                        />
                    </label>
                    <label className="check">
                        <input
                            type="checkbox"
                            checked={filters.hidePlaceholders}
                            onChange={(event) => change({ hidePlaceholders: event.target.checked })}
                        />
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
                        oldLabel={
                            fromUpdate
                                ? t('changes.stateAfter', { id: fromUpdate.id, date: stateName(fromUpdate) })
                                : t('changes.beforeImport')
                        }
                        newLabel={t('changes.stateAfter', { id: update.id, date: stateName(update) })}
                    />
                </div>
            )}
            <Pagination
                page={filters.page}
                total={data.total}
                pageSize={data.pageSize || PAGE_SIZE}
                onPage={(page) => change({ page })}
            />
            {import.meta.env.VITE_DATA_MODE !== 'static' && (
                <ManageStates
                    updates={updates.data ?? []}
                    shownIds={'from' in source ? [source.from, source.to] : [source.id]}
                />
            )}
        </>
    );
}

// Longer text values are truncated to this many characters.
const MAX_TEXT = 160;

// One table row of a changed item: one field with its old and new value (or a single spanning message).
interface FieldRowData {
    name: string;
    before?: ReactNode; // missing = cell is spanned by "message"
    after?: ReactNode;
    message?: string;
}

// Muted placeholder text for a value that does not exist.
const Missing = ({ text }: { text: string }) => <span className="muted">{text}</span>;

/** Rows of an entry: game_types always first, then the other fields in API order. */
function buildRows(item: UpdateChangeEntry, t: TFunction): FieldRowData[] {
    const rows: FieldRowData[] = [];
    const notStored = t('changes.notStored');
    const didNotExist = t('changes.didNotExist');
    const removedText = t('changes.removedValue');
    const absent = t('changes.absent');
    const { kind } = item;

    if (
        (kind !== 'changed' || item.changedFields.includes('game_types')) &&
        (item.gameTypesBefore || item.gameTypesAfter)
    ) {
        rows.push({
            name: 'game_types',
            before:
                kind === 'added' ? (
                    <Missing text={didNotExist} />
                ) : (
                    <GameTypeBadges gameTypes={item.gameTypesBefore ?? []} />
                ),
            after:
                kind === 'removed' ? (
                    <Missing text={removedText} />
                ) : (
                    <>
                        <GameTypeBadges gameTypes={item.gameTypesAfter ?? []} />
                        {kind === 'changed' && (
                            <GameTypeDiff before={item.gameTypesBefore ?? []} after={item.gameTypesAfter ?? []} />
                        )}
                    </>
                ),
        });
    }

    if (kind === 'changed' && item.before === null) {
        const others = item.changedFields.filter((fieldName) => fieldName !== 'game_types');
        if (others.length > 0) rows.push({ name: others.join(', '), message: notStored });
        return rows;
    }

    // Fields to show: the changed ones, or all stored fields for added/removed items.
    const names =
        kind === 'changed' ? item.changedFields : Object.keys((kind === 'added' ? item.after : item.before) ?? {});
    // One row per field; fields whose values were not recorded get a message instead of values.
    for (const name of names.filter((fieldName) => fieldName !== 'game_types')) {
        if (item.unknownFields?.includes(name)) {
            rows.push({ name, message: notStored });
            continue;
        }
        const before = item.before?.[name];
        const after = item.after?.[name];
        rows.push({
            name,
            before:
                kind === 'added' ? (
                    <Missing text={didNotExist} />
                ) : before === undefined ? (
                    <Missing text={absent} />
                ) : (
                    <ValueView value={before} />
                ),
            after:
                kind === 'removed' ? (
                    <Missing text={removedText} />
                ) : after === undefined ? (
                    <Missing text={absent} />
                ) : (
                    <ValueView value={after} />
                ),
        });
    }
    return rows;
}

/** Table of changed items; each item brings its own <tbody> via ChangeRows. */
function ChangesTable({
    items,
    oldLabel,
    newLabel,
}: {
    items: UpdateChangeEntry[];
    oldLabel: string;
    newLabel: string;
}) {
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

/** An entry as its own tbody: item cell with rowspan, plus one row per changed field. */
function ChangeRows({ item, oldLabel, newLabel }: { item: UpdateChangeEntry; oldLabel: string; newLabel: string }) {
    const { t } = useT();
    const dungeonChanged =
        (item.gameTypesBefore?.includes('Dungeon') ?? false) !== (item.gameTypesAfter?.includes('Dungeon') ?? false);
    // CSS classes: highlight changes of Dungeon (= Fractal candidate status) and removed items.
    const classes = [item.kind === 'changed' && dungeonChanged ? 'dungeon-change' : '', item.removed ? 'removed' : '']
        .filter(Boolean)
        .join(' ');
    const rows = buildRows(item, t);

    const itemCell = (
        <td rowSpan={Math.max(rows.length, 1)} className="item-cell">
            <div className="item-cell-body">
                <ItemIcon icon={item.icon} rarity={item.rarity} name={item.name} size={36} />
                <div>
                    <Link href={`/items/${item.id}`} className={`item-name ${rarityClass(item.rarity)}`}>
                        {item.name || `#${item.id}`}
                    </Link>
                    {/* In the German view the English name appears small underneath (old/new are English). */}
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
            {rows.map((row, rowIndex) => (
                <tr key={row.name} className="field-row">
                    {rowIndex === 0 && itemCell}
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

/** Readable value of a field: text with GW2 markup, arrays as chips, objects as "key: value". */
function ValueView({ value }: { value: unknown }) {
    const { t } = useT();
    if (typeof value === 'string') return <LongText text={value} />;
    if (Array.isArray(value)) {
        if (value.length === 0) return <span className="muted">{t('common.empty')}</span>;
        return (
            <span className="badges">
                {value.map((item, index) => (
                    <span key={index} className="badge">
                        {typeof item === 'string' ? item : JSON.stringify(item)}
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
                {entries.map(([key, item]) => (
                    <div key={key}>
                        <dt className="muted">{key}:</dt>{' '}
                        <dd>
                            {typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
                                ? String(item)
                                : JSON.stringify(item)}
                        </dd>
                    </div>
                ))}
            </dl>
        );
    }
    return <span>{value === null ? 'null' : String(value)}</span>;
}

/** Long texts truncated (without GW2 markup), complete with markup on click. */
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
