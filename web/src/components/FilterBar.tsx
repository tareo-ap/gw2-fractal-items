import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { describeUpdate } from '../lib/format';
import {
  GAME_TYPES,
  RARITIES,
  SORTS,
  countExtraFilters,
  type Candidate,
  type ListFilters,
  type SortField,
  type TestFilter,
} from '../lib/filters';

export type FilterChange = (change: Partial<ListFilters>, options?: { replace?: boolean; keepPage?: boolean }) => void;

const SORT_LABELS: Record<SortField, string> = {
  name: 'Name',
  id: 'ID',
  rarity: 'Seltenheit',
  level: 'Level',
  lastChanged: 'Zuletzt geändert',
};

const TEST_FILTER_LABELS: Record<TestFilter, string> = {
  untested: 'Ungetestet',
  works: 'Funktioniert',
  broken: 'Funktioniert nicht',
  retest: 'Neu testen',
};

export function FilterBar({ filters, onChange }: { filters: ListFilters; onChange: FilterChange }) {
  const extraCount = countExtraFilters(filters);
  // Nur beim ersten Rendern entscheiden, ob der Bereich offen ist; danach steuert der Nutzer.
  const [initiallyOpen] = useState(extraCount > 0);
  return (
    <section className="filters" aria-label="Suche und Filter">
      <div className="filter-row">
        <SearchInput value={filters.q} onSearch={(q) => onChange({ q }, { replace: true })} />
        <label className="field">
          <span className="field-label">Kandidat</span>
          <select value={filters.candidate} onChange={(e) => onChange({ candidate: e.target.value as Candidate })}>
            <option value="yes">Ja (Dungeon)</option>
            <option value="no">Nein</option>
            <option value="all">Alle</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Sortierung</span>
          <span className="sort-group">
            <select value={filters.sort} onChange={(e) => onChange({ sort: e.target.value as SortField })}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => onChange({ order: filters.order === 'asc' ? 'desc' : 'asc' })}
              title={filters.order === 'asc' ? 'Aufsteigend' : 'Absteigend'}
              aria-label={filters.order === 'asc' ? 'Aufsteigend, klicken für absteigend' : 'Absteigend, klicken für aufsteigend'}
            >
              {filters.order === 'asc' ? '↑' : '↓'}
            </button>
          </span>
        </label>
      </div>

      <details className="more-filters" open={initiallyOpen || undefined}>
        <summary>
          Weitere Filter{extraCount > 0 && <span className="tab-count">{extraCount}</span>}
        </summary>
        <div className="filter-groups">
          <ChipGroup
            label="Seltenheit"
            options={RARITIES}
            selected={filters.rarity}
            onChange={(rarity) => onChange({ rarity })}
            chipClass={(r) => `rarity-${r.toLowerCase()}`}
          />
          <ChipGroup label="Game Types (alle müssen passen)" options={GAME_TYPES} selected={filters.gameType} onChange={(gameType) => onChange({ gameType })} />
          <div className="filter-row">
            <label className="field">
              <span className="field-label">Teststatus</span>
              <select
                value={filters.testStatus ?? ''}
                onChange={(e) => onChange({ testStatus: (e.target.value || null) as TestFilter | null })}
              >
                <option value="">Alle</option>
                {(Object.keys(TEST_FILTER_LABELS) as TestFilter[]).map((t) => (
                  <option key={t} value={t}>
                    {TEST_FILTER_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <UpdateSelect value={filters.updateId} onChange={(updateId) => onChange({ updateId })} />
          </div>
          <div className="filter-row checks">
            {filters.view !== 'gizmo' && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={filters.hideCommon}
                  onChange={(e) => onChange({ hideCommon: e.target.checked })}
                />
                Food, Utility, Unlock, Transmutation ausblenden
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={filters.includeRemoved} onChange={(e) => onChange({ includeRemoved: e.target.checked })} />
              Entfernte Items anzeigen
            </label>
          </div>
        </div>
      </details>
    </section>
  );
}

/** Suchfeld mit Verzögerung: die URL wird erst 300 ms nach der letzten Eingabe aktualisiert. */
function SearchInput({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  const timer = useRef<number | undefined>(undefined);

  // Wert aus der URL übernehmen (z. B. nach "Zurück"), aber nicht während getippt wird.
  useEffect(() => {
    if (timer.current === undefined) setText(value);
  }, [value]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleChange = (next: string) => {
    setText(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      onSearch(next);
    }, 300);
  };

  return (
    <label className="field field-search">
      <span className="field-label">Suche</span>
      <input
        type="search"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Name, Beschreibung, ID oder Chat-Link"
        autoComplete="off"
      />
    </label>
  );
}

function ChipGroup<T extends string>({
  label,
  options,
  selected,
  onChange,
  chipClass,
}: {
  label: string;
  options: readonly T[];
  selected: T[];
  onChange: (values: T[]) => void;
  chipClass?: (value: T) => string;
}) {
  const toggle = (value: T) => {
    // Reihenfolge wie in options halten, damit die URL stabil bleibt.
    const next = selected.includes(value) ? selected.filter((v) => v !== value) : options.filter((o) => o === value || selected.includes(o));
    onChange(next);
  };
  return (
    <fieldset className="chip-group">
      <legend className="field-label">{label}</legend>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`chip ${chipClass?.(o) ?? ''} ${selected.includes(o) ? 'selected' : ''}`}
          aria-pressed={selected.includes(o)}
          onClick={() => toggle(o)}
        >
          {o}
        </button>
      ))}
      {selected.length > 0 && (
        <button type="button" className="chip chip-clear" onClick={() => onChange([])}>
          zurücksetzen
        </button>
      )}
    </fieldset>
  );
}

function UpdateSelect({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });
  return (
    <label className="field field-update">
      <span className="field-label">Nur aus Update</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={updates.isPending}>
        <option value="">{updates.isError ? 'Updates nicht ladbar' : 'Alle Updates'}</option>
        {/* Gewähltes Update auch dann anzeigen, wenn es (noch) nicht in der Liste ist. */}
        {value !== null && !updates.data?.some((u) => u.id === value) && <option value={value}>Update #{value}</option>}
        {updates.data?.map((u) => (
          <option key={u.id} value={u.id}>
            {describeUpdate(u)}
          </option>
        ))}
      </select>
    </label>
  );
}
