import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import type { AutoCheckStatus } from '../../../shared/types';
import { utcStamp } from '../lib/format';
import { errorText, useT, type I18n } from '../lib/i18n';
import { Link } from './common';

// ISO timestamp -> "YYYY-MM-DD HH:MM" in UTC.
const utc = (iso: string) => utcStamp(iso).replace('_', ' ');

// The auto check is the server's scheduled look for a new game build (patch) that triggers an update.
/** "Auto check: daily 06:00, Tue 17:00–19:00 every 30 min (Europe/Berlin) · next: … · last: …" */
function describeAutoCheck(autoCheck: AutoCheckStatus, t: I18n['t']): string {
    const { schedule } = autoCheck;
    const timeZone = schedule.timeZone;
    const parts = [
        schedule.patchWindow
            ? t('update.autoCheck', {
                  daily: schedule.dailyAt,
                  window: `${t(`autoCheck.day.${schedule.patchWindow.day}`)} ${schedule.patchWindow.start}–${schedule.patchWindow.end}`,
                  minutes: schedule.patchEveryMinutes,
                  tz: timeZone,
              })
            : t('update.autoCheckDaily', { daily: schedule.dailyAt, tz: timeZone }),
    ];
    if (autoCheck.nextCheckAt) parts.push(t('update.autoCheckNext', { time: utc(autoCheck.nextCheckAt) }));
    if (autoCheck.lastCheckAt && autoCheck.lastResult)
        parts.push(
            t('update.autoCheckLast', {
                time: utc(autoCheck.lastCheckAt),
                result: t(`autoCheck.${autoCheck.lastResult}`),
            }),
        );
    return parts.join(' · ');
}

// "Update" button: starts an import (reloads all items from the GW2 API) and polls the status while it runs.
export function UpdateButton() {
    const { t, formatNumber } = useT();
    const queryClient = useQueryClient();
    const [message, setMessage] = useState<string | null>(null);
    // Remembers the previous `running` value between renders to detect the running -> done transition.
    const wasRunning = useRef(false);

    // refetchInterval makes TanStack Query poll: every 1.5 s while an import runs, otherwise not at all (false).
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
    // useEffect with [running, queryClient]: runs after a render in which one of them changed.
    useEffect(() => {
        if (wasRunning.current && !running) {
            // invalidateQueries marks all cached queries whose key starts with `[key]` as stale and refetches the
            // active ones.
            for (const key of ['items', 'item', 'stats', 'updates']) {
                void queryClient.invalidateQueries({ queryKey: [key] });
            }
        }
        wasRunning.current = running;
    }, [running, queryClient]);

    // Mutation = write request; 409 Conflict means an import is already running (e.g. started in another tab).
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
    // Progress in percent, or null while the total is not known yet (shows an indeterminate bar).
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
