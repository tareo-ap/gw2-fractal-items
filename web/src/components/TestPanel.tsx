import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ItemDetail, TestStatus } from '../../../shared/types';
import { api } from '../api';
import { errorText, useT } from '../lib/i18n';
import { GameTypeDiff, TestBadge } from './common';

// Selectable test results. "Retest" is not a status: it is derived when game types changed after the test.
const STATUSES: TestStatus[] = ['untested', 'works', 'broken'];

/** Set the test status with a note (PUT /api/items/:id/test). */
export function TestPanel({ item }: { item: ItemDetail }) {
    const { t, formatDateTime } = useT();
    const queryClient = useQueryClient(); // access to the shared TanStack Query cache
    const [status, setStatus] = useState<TestStatus>(item.test.status);
    const [note, setNote] = useState(item.test.note ?? '');
    const [saved, setSaved] = useState(false);

    // useMutation = a write request (unlike useQuery, it only runs when .mutate() is called).
    const save = useMutation({
        mutationFn: () => api.setTest(item.id, { status, note: note.trim() || null }),
        onMutate: () => setSaved(false),
        onSuccess: async () => {
            setSaved(true);
            // Mark cached reads of this item and of all lists as stale so they are re-fetched with the new status.
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['item', item.id] }),
                queryClient.invalidateQueries({ queryKey: ['items'] }),
            ]);
        },
    });

    // True if the form differs from the stored test result.
    const dirty = status !== item.test.status || note.trim() !== (item.test.note ?? '').trim();

    return (
        <section className="panel test-panel">
            <h2>{t('testPanel.title')}</h2>
            {item.needsRetest && (
                <div className="warning" role="alert">
                    <strong>{t('testPanel.retestLabel')}</strong> {t('testPanel.retestText')}
                    <GameTypeDiff before={item.test.gameTypesAtTest ?? []} after={item.gameTypes} />
                </div>
            )}
            <p className="small muted">
                {item.test.testedAt
                    ? t('testPanel.lastTested', { date: formatDateTime(item.test.testedAt) })
                    : t('testPanel.never')}
            </p>

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    save.mutate();
                }}
            >
                <div className="segmented status-choice" role="radiogroup" aria-label={t('testPanel.status')}>
                    {STATUSES.map((statusOption) => (
                        <button
                            key={statusOption}
                            type="button"
                            role="radio"
                            aria-checked={status === statusOption}
                            className={status === statusOption ? `active test-${statusOption}` : ''}
                            onClick={() => {
                                setStatus(statusOption);
                                setSaved(false);
                            }}
                        >
                            {t(`test.${statusOption}`)}
                        </button>
                    ))}
                </div>
                <label className="field">
                    <span className="field-label">{t('testPanel.note')}</span>
                    <textarea
                        value={note}
                        rows={3}
                        onChange={(event) => {
                            setNote(event.target.value);
                            setSaved(false);
                        }}
                        placeholder={t('testPanel.notePlaceholder')}
                    />
                </label>
                <div className="form-actions">
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={save.isPending || (!dirty && !item.needsRetest)}
                    >
                        {save.isPending ? t('testPanel.saving') : t('testPanel.save')}
                    </button>
                    {saved && !dirty && <span className="small success">{t('testPanel.saved')}</span>}
                    {save.isError && (
                        <span className="small error">{t('testPanel.error', { error: errorText(save.error, t) })}</span>
                    )}
                </div>
                {item.needsRetest && !dirty && <p className="small muted">{t('testPanel.confirmHint')}</p>}
            </form>
        </section>
    );
}

/** Display the test status only (static version): status, note and date, without a form. */
export function TestInfo({ item }: { item: ItemDetail }) {
    const { t, formatDateTime } = useT();
    return (
        <section className="panel test-panel">
            <h2>{t('testPanel.title')}</h2>
            <p>
                <TestBadge status={item.test.status} needsRetest={false} />
            </p>
            {item.needsRetest && (
                <div className="warning" role="alert">
                    <strong>{t('testPanel.retestLabel')}</strong> {t('testPanel.retestText')}
                    <GameTypeDiff before={item.test.gameTypesAtTest ?? []} after={item.gameTypes} />
                </div>
            )}
            <p className="small muted">
                {item.test.testedAt
                    ? t('testPanel.lastTested', { date: formatDateTime(item.test.testedAt) })
                    : t('testPanel.never')}
            </p>
            {item.test.note && (
                <p style={{ whiteSpace: 'pre-wrap' }}>
                    <span className="field-label">{t('testPanel.note')}</span>
                    <br />
                    {item.test.note}
                </p>
            )}
            <p className="small muted">{t('testPanel.readOnly')}</p>
        </section>
    );
}
