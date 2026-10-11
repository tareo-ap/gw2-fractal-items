import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import type { AutoCheckStatus } from '../../../shared/types';
import { utcStamp } from '../lib/format';
import { errorText, useT, type I18n } from '../lib/i18n';
import { Link } from './common';

const utc = (iso: string) => utcStamp(iso).replace('_', ' ');

/** "Auto check: daily 06:00, Tue 17:00–19:00 every 30 min (Europe/Berlin) · next: … · last: …" */
function describeAutoCheck(a: AutoCheckStatus, t: I18n['t']): string {
    const { schedule: s } = a;
    const tz = s.timeZone;
    const parts = [
        s.patchWindow
            ? t('update.autoCheck', {
                  daily: s.dailyAt,
                  window: `${t(`autoCheck.day.${s.patchWindow.day}`)} ${s.patchWindow.start}–${s.patchWindow.end}`,
                  minutes: s.patchEveryMinutes,
                  tz,
              })
            : t('update.autoCheckDaily', { daily: s.dailyAt, tz }),
    ];
    if (a.nextCheckAt) parts.push(t('update.autoCheckNext', { time: utc(a.nextCheckAt) }));
    if (a.lastCheckAt && a.lastResult)
        parts.push(t('update.autoCheckLast', { time: utc(a.lastCheckAt), result: t(`autoCheck.${a.lastResult}`) }));
    return parts.join(' · ');
}

// "Update" button: starts an import and polls the status while it runs.
export function UpdateButton() {
    const { t, formatNumber } = useT();
    const queryClient = useQueryClient();
    const [message, setMessage] = useState<string | null>(null);
    const wasRunning = useRef(false);

    const status = useQuery({
        queryKey: ['importStatus'],
        queryFn: api.importStatus,
        refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
    });

    // The auto-check state is part of the key figures; reload every 60 s so "last" stays current.
    const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 60_000 });
    const autoCheck = stats.data?.autoCheck?.enabled ? stats.data.autoCheck : null;

    const running = status.data?.running ?? false;
    const autoCheckText = autoCheck ? describeAutoCheck(autoCheck, t) : '';

    // Transition from "running" to "done": reload lists, key figures and updates.
    useEffect(() => {
        if (wasRunning.current && !running) {
            for (const key of ['items', 'item', 'stats', 'updates']) {
                void queryClient.invalidateQueries({ queryKey: [key] });
            }
        }
        wasRunning.current = running;
    }, [running, queryClient]);

    const start = useMutation({
        mutationFn: api.startUpdate,
        onMutate: () => setMessage(null),
        onSuccess: () => {
            wasRunning.current = true;
        },
        onError: (error) => {
            if (error instanceof ApiError && error.status === 409) {
                wasRunning.current = true;
                setMessage(t('update.alreadyRunning'));
            } else {
                setMessage(t('update.startFailed', { error: errorText(error, t) }));
            }
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['importStatus'] }),
    });

    const data = status.data;
    const percent = data && data.total > 0 ? Math.min(100, Math.round((data.processed / data.total) * 100)) : null;

    return (
        <div className="update-box">
            <button
                type="button"
                className="btn btn-primary"
                onClick={() => start.mutate()}
                disabled={running || start.isPending}
                title={t('update.tooltip')}
            >
                {running ? t('update.running') : t('update.button')}
            </button>
            {running && data && (
                <div className="progress" aria-live="polite">
                    <div className="progress-label">
                        {t(`phase.${data.phase}`)}
                        {data.total > 0 && ` · ${formatNumber(data.processed)} / ${formatNumber(data.total)}`}
                    </div>
                    <div
                        className="progress-bar"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent ?? undefined}
                    >
                        <div
                            className={percent === null ? 'progress-fill indeterminate' : 'progress-fill'}
                            style={{ width: `${percent ?? 30}%` }}
                        />
                    </div>
                </div>
            )}
            {!running && data?.phase === 'done' && data.updateId !== null && (
                <Link href={`/updates/${data.updateId}`} className="small">
                    {t('update.viewChanges')}
                </Link>
            )}
            {/* Update done, but the German part is missing (error is only set for that at phase 'done') */}
            {!running && data?.phase === 'done' && data.error && (
                <span className="small muted">{t('update.germanIncomplete')}</span>
            )}
            {!running && data?.phase === 'failed' && (
                <span className="error small">
                    {t('update.lastFailed', { error: data.error ?? t('update.unknownError') })}
                </span>
            )}
            {autoCheck && <span className="small muted">{autoCheckText}</span>}
            {message && <span className="small muted">{message}</span>}
        </div>
    );
}
