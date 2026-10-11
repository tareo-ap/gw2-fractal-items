import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ItemDetail, TestStatus } from '../../../shared/types';
import { api } from '../api';
import { errorText, useT } from '../lib/i18n';
import { GameTypeDiff, TestBadge } from './common';

const STATUSES: TestStatus[] = ['untested', 'works', 'broken'];

/** Set the test status with a note (PUT /api/items/:id/test). */
export function TestPanel({ item }: { item: ItemDetail }) {
    const { t, formatDateTime } = useT();
    const queryClient = useQueryClient();
    const [status, setStatus] = useState<TestStatus>(item.test.status);
    const [note, setNote] = useState(item.test.note ?? '');
    const [saved, setSaved] = useState(false);

    const save = useMutation({
        mutationFn: () => api.setTest(item.id, { status, note: note.trim() || null }),
        onMutate: () => setSaved(false),
        onSuccess: async () => {
            setSaved(true);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['item', item.id] }),
                queryClient.invalidateQueries({ queryKey: ['items'] }),
            ]);
        },
    });

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
                onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate();
                }}
            >
                <div className="segmented status-choice" role="radiogroup" aria-label={t('testPanel.status')}>
                    {STATUSES.map((s) => (
                        <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={status === s}
                            className={status === s ? `active test-${s}` : ''}
                            onClick={() => {
                                setStatus(s);
                                setSaved(false);
                            }}
                        >
                            {t(`test.${s}`)}
                        </button>
                    ))}
                </div>
                <label className="field">
                    <span className="field-label">{t('testPanel.note')}</span>
                    <textarea
                        value={note}
                        rows={3}
                        onChange={(e) => {
                            setNote(e.target.value);
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
