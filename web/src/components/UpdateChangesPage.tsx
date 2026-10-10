import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ChangeFocus, ChangeKind, ItemView, UpdateChangeEntry } from '../../../shared/types';
import { api, ApiError } from '../api';
import { CHANGE_KINDS, changesUrl, parseChangesFilters, toChangesApiQuery, type ChangesFilters } from '../lib/changes';
import { CHANGE_LABELS, describeUpdate, formatDateTime, formatNumber, rarityClass } from '../lib/format';
import { PAGE_SIZE } from '../lib/filters';
import { navigate } from '../lib/router';
import { ErrorBox, GameTypeBadges, GameTypeDiff, ItemIcon, Link, Loading } from './common';
import { Gw2Text } from './Gw2Text';
import { Pagination } from './ItemListPage';

const FOCUS_LABELS: Record<ChangeFocus, string> = {
  all: 'Alle',
  gameTypes: 'game_types geändert',
  dungeonGained: 'Dungeon dazu',
  dungeonLost: 'Dungeon weg',
};

const TYPE_LABELS: [ItemView, string][] = [
  ['gizmo', 'Gizmo'],
  ['consumable', 'Consumable'],
  ['tonic', 'Tonics'],
  ['all', 'Alle'],
];

/** "/updates": springt auf das neueste abgeschlossene Update. */
export function UpdatesRedirect() {
  const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });
  const latest = updates.data?.find((u) => u.status === undefined || u.status === 'done');

  useEffect(() => {
    if (latest) navigate(changesUrl(latest.id), { replace: true });
  }, [latest]);

  if (updates.isError) {
    return <ErrorBox message={`Updates konnten nicht geladen werden: ${updates.error.message}`} onRetry={() => void updates.refetch()} />;
  }
  if (updates.isPending || latest) return <Loading text="Lade Updates …" />;
  return (
    <div className="empty">
      <p>Noch kein Update. Mit „Aktualisieren“ oben rechts die Items laden.</p>
    </div>
  );
}

function same<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Änderungen eines Updates: Zähler als Filter-Kacheln, Filterleiste und Liste. */
export function UpdateChangesPage({ id, params }: { id: number; params: URLSearchParams }) {
  const filters = parseChangesFilters(params);
  const query = toChangesApiQuery(filters);
  const changes = useQuery({
    queryKey: ['updateChanges', id, query],
    queryFn: () => api.updateChanges(id, query),
    placeholderData: keepPreviousData, // alte Seite stehen lassen, bis die neue da ist
  });
  const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });

  // Jede Filteränderung springt auf Seite 1, außer beim Blättern selbst (patch.page).
  const change = (patch: Partial<ChangesFilters>, options: { replace?: boolean } = {}) =>
    navigate(changesUrl(id, { ...filters, page: 1, ...patch }), options);

  if (changes.isError && !changes.data) {
    const notFound = changes.error instanceof ApiError && changes.error.status === 404;
    return notFound ? (
      <div className="empty">
        <p>Dieses Update gibt es nicht.</p>
        <Link href="/updates">Zum neuesten Update</Link>
      </div>
    ) : (
      <ErrorBox message={`Änderungen konnten nicht geladen werden: ${changes.error.message}`} onRetry={() => void changes.refetch()} />
    );
  }
  if (!changes.data) return <Loading text="Lade Änderungen …" />;

  const data = changes.data;
  const { update, counts } = data;
  // Das älteste Update ist der Vollimport: Dort ist alles neu, ein Vergleich lohnt erst ab dem zweiten.
  const isFirst = updates.data !== undefined && updates.data.every((u) => u.id >= update.id);

  const kindTile = (kind: ChangeKind, count: number, className: string) => ({
    label: CHANGE_LABELS[kind],
    count,
    patch: { kind: [kind], focus: 'all' } as Partial<ChangesFilters>,
    active: same(filters.kind, [kind]) && filters.focus === 'all',
    className,
  });
  const focusTile = (focus: ChangeFocus, count: number, className = '') => ({
    label: FOCUS_LABELS[focus],
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
          <h2>Änderungen im Update #{update.id}</h2>
          <div className="small muted">
            {formatDateTime(update.startedAt)} · Build {update.buildId ?? 'unbekannt'} ·{' '}
            {update.status === 'done' ? 'abgeschlossen' : update.status === 'running' ? 'läuft noch' : 'fehlgeschlagen'}
          </div>
        </div>
        <label className="field field-update">
          <span className="field-label">Update</span>
          <select value={update.id} onChange={(e) => navigate(changesUrl(Number(e.target.value), { ...filters, page: 1 }))}>
            {updates.data && !updates.data.some((u) => u.id === update.id) && <option value={update.id}>Update #{update.id}</option>}
            {(updates.data ?? [update]).map((u) => (
              <option key={u.id} value={u.id}>
                {describeUpdate(u)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {update.status === 'failed' && <div className="warning">Dieses Update ist fehlgeschlagen{update.error ? `: ${update.error}` : ''}.</div>}
      {isFirst && (
        <div className="warning">
          Das ist das erste Update (Vollimport), deshalb sind alle Items „Neu“. Ein Vergleich ist erst ab dem zweiten Update sinnvoll.
        </div>
      )}

      <div className="count-tiles">
        {tiles.map((tile) => (
          <Link key={tile.label} href={changesUrl(id, { ...filters, ...tile.patch, page: 1 })} className={tile.active ? 'count-tile active' : 'count-tile'}>
            <span className={`count-tile-value ${tile.count > 0 ? tile.className : 'muted'}`}>{formatNumber(tile.count)}</span>
            <span className="small muted">{tile.label}</span>
          </Link>
        ))}
      </div>

      <section className="filters" aria-label="Filter">
        <div className="filter-row">
          <fieldset className="chip-group">
            <legend className="field-label">Art</legend>
            {CHANGE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`chip ${filters.kind.includes(kind) ? 'selected' : ''}`}
                aria-pressed={filters.kind.includes(kind)}
                onClick={() => toggleKind(kind)}
              >
                {CHANGE_LABELS[kind]}
              </button>
            ))}
          </fieldset>
          <div className="field">
            <span className="field-label">Fokus</span>
            <div className="segmented" role="group" aria-label="Fokus">
              {(Object.keys(FOCUS_LABELS) as ChangeFocus[]).map((focus) => (
                <button key={focus} type="button" className={filters.focus === focus ? 'active' : ''} aria-pressed={filters.focus === focus} onClick={() => change({ focus })}>
                  {FOCUS_LABELS[focus]}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Typ</span>
            <div className="segmented" role="group" aria-label="Typ">
              {TYPE_LABELS.map(([type, label]) => (
                <button key={type} type="button" className={filters.type === type ? 'active' : ''} aria-pressed={filters.type === type} onClick={() => change({ type })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="filter-row changes-search">
          <label className="field field-search">
            <span className="field-label">Suche</span>
            <input
              type="search"
              key={`${id}-${filters.q}`}
              defaultValue={filters.q}
              onChange={(e) => change({ q: e.target.value }, { replace: true })}
              placeholder="Name oder ID"
              autoComplete="off"
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={filters.hidePlaceholders} onChange={(e) => change({ hidePlaceholders: e.target.checked })} />
            Platzhalter ausblenden
          </label>
        </div>
      </section>

      <div className="result-bar">
        <span className="muted" aria-live="polite">
          {formatNumber(data.total)} Einträge{changes.isFetching && ' · aktualisiere …'}
        </span>
      </div>

      {data.items.length === 0 ? (
        <p className="empty">Keine Änderungen für diese Filter.</p>
      ) : (
        <div className={changes.isPlaceholderData ? 'results stale' : 'results'}>
          <ChangesTable items={data.items} />
        </div>
      )}
      <Pagination page={filters.page} total={data.total} pageSize={data.pageSize || PAGE_SIZE} onPage={(page) => change({ page })} />
    </>
  );
}

const MAX_TEXT = 160;
const NOT_STORED = 'alter Wert nicht gespeichert (Update vor dieser Version)';

interface FieldRowData {
  name: string;
  before?: ReactNode; // fehlt = Zelle wird von "message" überspannt
  after?: ReactNode;
  message?: string;
}

const Missing = ({ text = 'gab es noch nicht' }: { text?: string }) => <span className="muted">{text}</span>;

/** Zeilen eines Eintrags: game_types immer zuerst, danach die übrigen Felder in API-Reihenfolge. */
function buildRows(item: UpdateChangeEntry): FieldRowData[] {
  const rows: FieldRowData[] = [];
  const { kind } = item;

  if ((kind !== 'changed' || item.changedFields.includes('game_types')) && (item.gameTypesBefore || item.gameTypesAfter)) {
    rows.push({
      name: 'game_types',
      before: kind === 'added' ? <Missing /> : <GameTypeBadges gameTypes={item.gameTypesBefore ?? []} />,
      after:
        kind === 'removed' ? (
          <Missing text="entfernt" />
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
    if (others.length > 0) rows.push({ name: others.join(', '), message: NOT_STORED });
    return rows;
  }

  const names = kind === 'changed' ? item.changedFields : Object.keys((kind === 'added' ? item.after : item.before) ?? {});
  for (const name of names.filter((n) => n !== 'game_types')) {
    const before = item.before?.[name];
    const after = item.after?.[name];
    rows.push({
      name,
      before: kind === 'added' ? <Missing /> : before === undefined ? <Missing text="nicht vorhanden" /> : <ValueView value={before} />,
      after: kind === 'removed' ? <Missing text="entfernt" /> : after === undefined ? <Missing text="nicht vorhanden" /> : <ValueView value={after} />,
    });
  }
  return rows;
}

function ChangesTable({ items }: { items: UpdateChangeEntry[] }) {
  return (
    <table className="item-table changes-table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Feld</th>
          <th>Alt</th>
          <th>Neu</th>
        </tr>
      </thead>
      {items.map((item) => (
        <ChangeRows key={`${item.id}-${item.kind}`} item={item} />
      ))}
    </table>
  );
}

/** Ein Eintrag als eigener tbody: Item-Zelle mit rowspan, dazu eine Zeile pro geändertem Feld. */
function ChangeRows({ item }: { item: UpdateChangeEntry }) {
  const dungeonChanged = (item.gameTypesBefore?.includes('Dungeon') ?? false) !== (item.gameTypesAfter?.includes('Dungeon') ?? false);
  const classes = [item.kind === 'changed' && dungeonChanged ? 'dungeon-change' : '', item.removed ? 'removed' : ''].filter(Boolean).join(' ');
  const rows = buildRows(item);

  const itemCell = (
    <td rowSpan={Math.max(rows.length, 1)} className="item-cell">
      <div className="item-cell-body">
        <ItemIcon icon={item.icon} rarity={item.rarity} name={item.name} size={36} />
        <div>
          <Link href={`/items/${item.id}`} className={`item-name ${rarityClass(item.rarity)}`}>
            {item.name || `#${item.id}`}
          </Link>
          <div className="small muted">
            {item.type}
            {item.subtype && ` · ${item.subtype}`} · #{item.id}
          </div>
          <span className={`badge change-${item.kind}`}>{CHANGE_LABELS[item.kind]}</span>
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
            Keine Feldänderung erfasst.
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
              <td className="value-cell" data-label="Alt">
                {row.before}
              </td>
              <td className="value-cell" data-label="Neu">
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
  if (typeof value === 'string') return <LongText text={value} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">leer</span>;
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
    if (entries.length === 0) return <span className="muted">leer</span>;
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
  const [open, setOpen] = useState(false);
  if (text === '') return <span className="muted">leer</span>;
  if (text.length <= MAX_TEXT) return <Gw2Text text={text} />;
  return (
    <>
      {open ? <Gw2Text text={text} /> : <span>{text.replace(/<[^>]*>/g, '').slice(0, MAX_TEXT)} …</span>}{' '}
      <button type="button" className="link-button small" onClick={() => setOpen(!open)}>
        {open ? 'weniger' : 'mehr'}
      </button>
    </>
  );
}
