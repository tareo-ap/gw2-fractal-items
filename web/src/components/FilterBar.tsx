import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { describeUpdate } from '../lib/format';
import { useT } from '../lib/i18n';
import { isHiddenByHideCommon } from '../../../shared/rules';
import {
    CONSUMABLE_SUBTYPES,
    GAME_TYPES,
    ITEM_TYPE_FILTER,
    RARITIES,
    SORTS,
    countExtraFilters,
    hasHideCommon,
    hasItemTypeFilter,
    hasSubtypeFilter,
    type Candidate,
    type ListFilters,
    type SortField,
    type TestFilter,
} from '../lib/filters';

// Callback type for filter changes: `Partial<ListFilters>` = any subset of the filter fields. `keepPage` skips the
// reset to page 1; `replace` overwrites the history entry (used while typing so "Back" is not flooded).
export type FilterChange = (change: Partial<ListFilters>, options?: { replace?: boolean; keepPage?: boolean }) => void;

// Options of the test status dropdown. `retest` = tested earlier but the item changed since.
const TEST_FILTERS: TestFilter[] = ['untested', 'works', 'broken', 'retest'];

/** Filter controls above the list: search, candidate, sort, and a collapsible section with the rest. */
export function FilterBar({ filters, onChange }: { filters: ListFilters; onChange: FilterChange }) {
    const { t } = useT();
    // Filters in the collapsible section that differ from their defaults (shown as a badge on the summary).
    const extraCount = countExtraFilters(filters);
    // Decide only on the first render whether the section is open; afterwards the user controls it.
    // useState with only the first tuple element: the initial value is computed once and never updated.
    const [initiallyOpen] = useState(extraCount > 0);
    return (
        <section className="filters" aria-label={t('filter.aria')}>
            <div className="filter-row">
                <SearchInput value={filters.q} onSearch={(query) => onChange({ q: query }, { replace: true })} />
                <label className="field">
                    <span className="field-label">{t('filter.candidate')}</span>
                    <select
                        value={filters.candidate}
                        onChange={(event) => onChange({ candidate: event.target.value as Candidate })}
                    >
                        <option value="yes">{t('filter.candidate.yes')}</option>
                        <option value="no">{t('filter.candidate.no')}</option>
                        <option value="all">{t('filter.candidate.all')}</option>
                    </select>
                </label>
                <label className="field">
                    <span className="field-label">{t('filter.sort')}</span>
                    <span className="sort-group">
                        <select
                            value={filters.sort}
                            onChange={(event) => onChange({ sort: event.target.value as SortField })}
                        >
                            {SORTS.map((sortField) => (
                                <option key={sortField} value={sortField}>
                                    {t(`sort.${sortField}`)}
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
                    {t('filter.more')}
                    {extraCount > 0 && <span className="tab-count">{extraCount}</span>}
                </summary>
                <div className="filter-groups">
                    {hasItemTypeFilter(filters.view) && (
                        <ChipGroup
                            label={t('filter.itemType')}
                            options={ITEM_TYPE_FILTER}
                            selected={filters.itemType}
                            onChange={(itemType) => onChange({ itemType })}
                        />
                    )}
                    {hasSubtypeFilter(filters.view) && (
                        <ChipGroup
                            label={t('filter.subtype')}
                            options={CONSUMABLE_SUBTYPES}
                            selected={filters.subtype}
                            onChange={(subtype) => onChange({ subtype })}
                            optionLabel={(subtype) => t(`subtype.${subtype}`)}
                            // hideCommon removes these subtypes completely, so selecting them would give 0 results.
                            // Already selected ones stay clickable so the user can still deselect them.
                            disabledHint={
                                filters.hideCommon
                                    ? t('filter.subtypeHiddenByHideCommon', { option: t('filter.hideCommon') })
                                    : undefined
                            }
                            isDisabled={(subtype) => filters.hideCommon && isHiddenByHideCommon(subtype)}
                        />
                    )}
                    <ChipGroup
                        label={t('filter.rarity')}
                        options={RARITIES}
                        selected={filters.rarity}
                        onChange={(rarity) => onChange({ rarity })}
                        chipClass={(rarity) => `rarity-${rarity.toLowerCase()}`}
                    />
                    <ChipGroup
                        label={t('filter.gameTypes')}
                        options={GAME_TYPES}
                        selected={filters.gameType}
                        onChange={(gameType) => onChange({ gameType })}
                    />
                    <div className="filter-row">
                        <label className="field">
                            <span className="field-label">{t('filter.testStatus')}</span>
                            <select
                                value={filters.testStatus ?? ''}
                                onChange={(event) =>
                                    onChange({ testStatus: (event.target.value || null) as TestFilter | null })
                                }
                            >
                                <option value="">{t('filter.all')}</option>
                                {TEST_FILTERS.map((testFilter) => (
                                    <option key={testFilter} value={testFilter}>
                                        {t(`test.${testFilter}`)}
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
                                    onChange={(event) => onChange({ hideCommon: event.target.checked })}
                                />
                                {t('filter.hideCommon')}
                            </label>
                        )}
                        <label className="check">
                            <input
                                type="checkbox"
                                checked={filters.hidePlaceholders}
                                onChange={(event) => onChange({ hidePlaceholders: event.target.checked })}
                            />
                            {t('filter.hidePlaceholders')}
                        </label>
                        <label className="check">
                            <input
                                type="checkbox"
                                checked={filters.hideAutoConsumed}
                                onChange={(event) => onChange({ hideAutoConsumed: event.target.checked })}
                            />
                            {t('filter.hideAutoConsumed')}
                        </label>
                        <label className="check">
                            <input
                                type="checkbox"
                                checked={filters.hideGuildHomestead}
                                onChange={(event) => onChange({ hideGuildHomestead: event.target.checked })}
                            />
                            {t('filter.hideGuildHomestead')}
                        </label>
                        <label className="check">
                            <input
                                type="checkbox"
                                checked={filters.includeRemoved}
                                onChange={(event) => onChange({ includeRemoved: event.target.checked })}
                            />
                            {t('filter.includeRemoved')}
                        </label>
                    </div>
                </div>
            </details>
        </section>
    );
}

// `event.target.value as Candidate`: a type assertion (TS only, no runtime check) because <select> values are plain
// strings.
/** Debounced search field: the URL is updated only 300 ms after the last input. */
function SearchInput({ value, onSearch }: { value: string; onSearch: (query: string) => void }) {
    const { t } = useT();
    // Local text state so typing is instant; the URL (and thus the list query) follows after the debounce.
    const [text, setText] = useState(value);
    // useRef: mutable box that survives re-renders without causing one; holds the pending timeout id.
    const timer = useRef<number | undefined>(undefined);

    // Take the value from the URL (e.g. after "Back"), but not while typing.
    useEffect(() => {
        if (timer.current === undefined) setText(value);
    }, [value]);

    // Cleanup on unmount: cancel a pending debounce timer. (An effect returning a function = its cleanup.)
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
                onChange={(event) => handleChange(event.target.value)}
                placeholder={t('filter.searchPlaceholder')}
                autoComplete="off"
            />
        </label>
    );
}

/**
 * Multi-select as toggle buttons ("chips"). Generic over the option type T so it works for rarities and game types
 * alike.
 */
function ChipGroup<T extends string>({
    label,
    options,
    selected,
    onChange,
    chipClass,
    optionLabel,
    isDisabled,
    disabledHint,
}: {
    label: string;
    options: readonly T[];
    selected: T[];
    onChange: (values: T[]) => void;
    chipClass?: (value: T) => string;
    // Text shown on the chip instead of the raw option value (e.g. translated subtype names).
    optionLabel?: (value: T) => string;
    // Options that cannot be newly selected. A selected option stays clickable so it can be removed again.
    isDisabled?: (value: T) => boolean;
    // Explanation for affected options (tooltip on disabled chips and a short text below the chips). It also applies to
    // an already selected affected option, which stays clickable but gives no results.
    disabledHint?: string;
}) {
    const { t } = useT();
    const hintId = useId(); // links the hint text to the affected chips via aria-describedby
    const toggle = (value: T) => {
        // Keep the order as in options so the URL stays stable.
        const next = selected.includes(value)
            ? selected.filter((selectedValue) => selectedValue !== value)
            : options.filter((option) => option === value || selected.includes(option));
        onChange(next);
    };
    return (
        <fieldset className="chip-group">
            <legend className="field-label">{label}</legend>
            {options.map((option) => {
                const affected = !!isDisabled?.(option);
                const disabled = !selected.includes(option) && affected;
                return (
                    <button
                        key={option}
                        type="button"
                        className={`chip ${chipClass?.(option) ?? ''} ${selected.includes(option) ? 'selected' : ''}`}
                        aria-pressed={selected.includes(option)}
                        disabled={disabled}
                        title={disabled ? disabledHint : undefined}
                        aria-describedby={affected && disabledHint ? hintId : undefined}
                        onClick={() => toggle(option)}
                    >
                        {optionLabel ? optionLabel(option) : option}
                    </button>
                );
            })}
            {disabledHint && options.some((option) => isDisabled?.(option)) && (
                <small id={hintId} className="field-hint">
                    {disabledHint}
                </small>
            )}
            {selected.length > 0 && (
                <button type="button" className="chip chip-clear" onClick={() => onChange([])}>
                    {t('filter.clear')}
                </button>
            )}
        </fieldset>
    );
}

/** Dropdown to filter by the update (stored snapshot) in which an item was added or changed. */
function UpdateSelect({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
    const i18n = useT(); // kept whole because describeUpdate needs the i18n object
    const { t } = i18n;
    // Same queryKey as in Header: TanStack Query serves both from one cached request.
    const updates = useQuery({ queryKey: ['updates'], queryFn: api.updates });
    // First state = full import (only needed for the static version, see below).
    const baseline = updates.data?.length ? Math.min(...updates.data.map((update) => update.id)) : undefined;
    return (
        <label className="field field-update">
            <span className="field-label">{t('filter.update')}</span>
            <select
                value={value ?? ''}
                onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
                disabled={updates.isPending}
            >
                <option value="">{updates.isError ? t('filter.updatesFailed') : t('filter.allUpdates')}</option>
                {/* Show the selected update even if it is not (yet) in the list. */}
                {value !== null && !updates.data?.some((update) => update.id === value) && (
                    <option value={value}>{t('filter.updateN', { id: value })}</option>
                )}
                {updates.data
                    // The static version has no changes for the first state (full import), so the filter would stay
                    // empty.
                    ?.filter((update) => import.meta.env.VITE_DATA_MODE !== 'static' || update.id !== baseline)
                    .map((update) => (
                        <option key={update.id} value={update.id}>
                            {describeUpdate(update, i18n)}
                        </option>
                    ))}
            </select>
        </label>
    );
}
