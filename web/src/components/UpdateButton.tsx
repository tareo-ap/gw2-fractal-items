import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { errorText, useT } from '../lib/i18n';
import { Link } from './common';

// Button "Aktualisieren": startet einen Import und pollt den Status, solange er läuft.
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

  const running = status.data?.running ?? false;

  // Wechsel von "läuft" auf "fertig": Listen, Kennzahlen und Updates neu laden.
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
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
            <div className={percent === null ? 'progress-fill indeterminate' : 'progress-fill'} style={{ width: `${percent ?? 30}%` }} />
          </div>
        </div>
      )}
      {!running && data?.phase === 'done' && data.updateId !== null && (
        <Link href={`/updates/${data.updateId}`} className="small">
          {t('update.viewChanges')}
        </Link>
      )}
      {/* Update fertig, aber der deutsche Teil fehlt (error ist bei phase 'done' nur dafür gesetzt) */}
      {!running && data?.phase === 'done' && data.error && <span className="small muted">{t('update.germanIncomplete')}</span>}
      {!running && data?.phase === 'failed' && (
        <span className="error small">{t('update.lastFailed', { error: data.error ?? t('update.unknownError') })}</span>
      )}
      {message && <span className="small muted">{message}</span>}
    </div>
  );
}
