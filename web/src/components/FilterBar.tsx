import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { describeUpdate } from '../lib/format';
import { useT } from '../lib/i18n';
import {
  GAME_TYPES,
  RARITIES,
  SORTS,
  countExtraFilters,
  hasHideCommon,
  type Candidate,
  type ListFilters,
  type SortField,
  type TestFilter,
} from '../lib/filters';

export type FilterChange = (change: Partial<ListFilters>, options?: { replace?: boolean; keepPage?: boolean }) => void;

const TEST_FILTERS: TestFilter[] = ['untested', 'works', 'broken', 'retest'];

export function FilterBar({ filters, onChange }: { filters: ListFilters; onChange: FilterChange }) {
  const { t } = useT();
  const extraCount = countExtraFilters(filters);
  // Decide only on the first render whether the section is open; afterwards the user controls it.
  const [initiallyOpen] = useState(extraCount > 0);
  return (
    <section className="filters" aria-label={t('filter.aria')}>
      <div className="filter-row">
        <SearchInput value={filters.q} onSearch={(q) => onChange({ q }, { replace: true })} />
        <label className="field">
          <span className="field-label">{t('filter.candidate')}</span>
          <select value={filters.candidate} onChange={(e) => onChange({ candidate: e.target.value as Candidate })}>
            <option value="yes">{t('filter.candidate.yes')}</option>
            <option value="no">{t('filter.candidate.no')}</option>
            <option value="all">{t('filter.candidate.all')}</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('filter.sort')}</span>
          <span className="sort-group">
            <select value={filters.sort} onChange={(e) => onChange({ sort: e.target.value as SortField })}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => onChange({ order: filters.order === 'asc' ? 'desc' : 'asc' })}
              title={filters.order === 'asc' ? t('filter.asc') : t('filter.desc')}
              aria-label={filters.order === 'asc' ? t('filter.ascAria') : t('filter.descAria')}
            >
              {filters.order === 'asc' ? '↑' : '↓'}
            </button>
          </span>
        </label>
      </div>

      <details className="more-filters" open={initiallyOpen || undefined}>
        <summary>
          {t('filter.more')}{extraCount > 0 && <span className="tab-count">{extraCount}</span>}
        </summary>
        <div className="filter-groups">
          <ChipGroup
            label={t('filter.rarity')}
            options={RARITIES}
            selected={filters.rarity}
            onChange={(rarity) => onChange({ rarity })}
            chipClass={(r) => `rarity-${r.toLowerCase()}`}
          />
          <ChipGroup label={t('filter.gameTypes')} options={GAME_TYPES} selected={filters.gameType} onChange={(gameType) => onChange({ gameType })} />
          <div className="filter-row">
            <label className="field">
              <span className="field-label">{t('filter.testStatus')}</span>
              <select
                value={filters.testStatus ?? ''}
                onChange={(e) => onChange({ testStatus: (e.target.value || null) as TestFilter | null })}
              >
                <option value="">{t('filter.all')}</option>
                {TEST_FILTERS.map((f) => (
                  <option key={f} value={f}>
                    {t(`test.${f}`)}
                  </option>
                ))}
              </select>
            </label>
            <UpdateSelect value={filters.updateId} onChange={(updateId) => onChange({ updateId })} />
          </div>
          <div className="filter-row checks">
            {hasHideCommon(filters.view) && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={filters.hideCommon}
                  onChange={(e) => onChange({ hideCommon: e.target.checked })}
                />
                {t('filter.hideCommon')}
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={filters.hidePlaceholders}
                onChange={(e) => onChange({ hidePlaceholders: e.target.checked })}
              />
              {t('filter.hidePlaceholders')}
            </label>
            <label className="check">
              <input type="checkbox" checked={filters.includeRemoved} onChange={(e) => onChange({ includeRemoved: e.target.checked })} />
              {t('filter.includeRemoved')}
            </label>
          </div>
        </div>
      </details>
    </section>
  );
}

/** Debounced search field: the URL is updated only 300 ms after the last input. */
function SearchInput({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const { t } = useT();
  const [text, setText] = useState(value);
  const timer = useRef<number | undefined>(undefined);

  // Take the value from the URL (e.g. after "Back"), but not while typing.
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
      <span className="field-label">{t('filter.search')}</span>
      <input
        type="search"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={t('filter.searchPlaceholder')}
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
  const { t } = useT();
  const toggle = (value: T) => {
    // Keep the order as in options so the URL stays stable.
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
          {t('filter.clear')}
        </button>
      )}
    </fieldset>
  );
}

function UpdateSelect({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const i18n = useT();
  const { t } = i18n;
  const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });
  // First state = full import (only needed for the static version, see below).
  const baseline = updates.data?.length ? Math.min(...updates.data.map((u) => u.id)) : undefined;
  return (
    <label className="field field-update">
      <span className="field-label">{t('filter.update')}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={updates.isPending}>
        <option value="">{updates.isError ? t('filter.updatesFailed') : t('filter.allUpdates')}</option>
        {/* Show the selected update even if it is not (yet) in the list. */}
        {value !== null && !updates.data?.some((u) => u.id === value) && <option value={value}>{t('filter.updateN', { id: value })}</option>}
        {updates.data
          // The static version has no changes for the first state (full import), so the filter would stay empty.
          ?.filter((u) => import.meta.env.VITE_DATA_MODE !== 'static' || u.id !== baseline)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {describeUpdate(u, i18n)}
            </option>
          ))}
      </select>
    </label>
  );
}
