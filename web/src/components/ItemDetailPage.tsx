import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ItemDetail } from '../../../shared/types';
import { api, ApiError } from '../api';
import { formatCoins, rarityClass } from '../lib/format';
import { errorText, useT } from '../lib/i18n';
import { ErrorBox, GameTypeBadges, ItemIcon, Link, Loading } from './common';
import { Gw2Text } from './Gw2Text';
import { HistoryList } from './HistoryList';
import { TestInfo, TestPanel } from './TestPanel';

export function ItemDetailPage({ id, backHref }: { id: number; backHref: string }) {
  const { t, lang } = useT();
  const item = useQuery({
    queryKey: ['item', id, lang],
    queryFn: () => api.item(id, lang),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  return (
    <div className="detail-page">
      <Link href={backHref} className="back-link">
        {t('detail.back')}
      </Link>
      {item.isPending && <Loading text={t('detail.loading')} />}
      {item.isError &&
        (item.error instanceof ApiError && item.error.status === 404 ? (
          <ErrorBox message={t('detail.notFound', { id })} />
        ) : (
          <ErrorBox message={t('detail.loadError', { error: errorText(item.error, t) })} onRetry={() => void item.refetch()} />
        ))}
      {item.data && (
        <div className="detail-layout">
          <div className="detail-main">
            <Tooltip item={item.data} />
            <RawDetails details={item.data.details} />
          </div>
          <div className="detail-side">
            {import.meta.env.VITE_DATA_MODE === 'static' ? (
              <TestInfo item={item.data} />
            ) : (
              /* key: reset the form when switching to another item */
              <TestPanel key={item.data.id} item={item.data} />
            )}
            <section className="panel">
              <h2>{t('detail.history')}</h2>
              <HistoryList history={item.data.history} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/** Box in the style of the in-game tooltip. */
function Tooltip({ item }: { item: ItemDetail }) {
  const { t } = useT();
  return (
    <article className={`tooltip ${rarityClass(item.rarity)} ${item.removed ? 'removed' : ''}`}>
      <header className="tooltip-head">
        <ItemIcon icon={item.icon} rarity={item.rarity} name={item.name} size={64} />
        <div>
          <h1 className="item-name tooltip-name">{item.name || `#${item.id}`}</h1>
          {item.nameEn !== item.name && <div className="small muted">{t('detail.englishName', { name: item.nameEn })}</div>}
          <div className="small muted">
            #{item.id}
            {item.removed && <span className="badge badge-removed">{t('detail.removedBadge')}</span>}
          </div>
        </div>
      </header>

      {item.description && (
        <p className="tooltip-desc">
          <Gw2Text text={item.description} />
        </p>
      )}

      <dl className="tooltip-props">
        <dt>{t('detail.type')}</dt>
        <dd>
          {item.type}
          {item.subtype && ` · ${item.subtype}`}
        </dd>
        <dt>{t('detail.rarity')}</dt>
        <dd className="item-name">{item.rarity}</dd>
        <dt>{t('detail.level')}</dt>
        <dd>{item.level}</dd>
        <dt>Game Types</dt>
        <dd>
          <GameTypeBadges gameTypes={item.gameTypes} />
          {item.isCandidate && <span className="small candidate-hint"> {t('detail.candidate')}</span>}
        </dd>
        <dt>Flags</dt>
        <dd>{item.flags.length ? item.flags.join(', ') : '–'}</dd>
        <dt>Restrictions</dt>
        <dd>{item.restrictions.length ? item.restrictions.join(', ') : '–'}</dd>
        <dt>{t('detail.vendorValue')}</dt>
        <dd>{formatCoins(item.vendorValue)}</dd>
      </dl>

      <footer className="tooltip-foot">
        {item.chatLink && <ChatLink code={item.chatLink} />}
        <a href={item.wikiUrl} target="_blank" rel="noreferrer noopener" className="btn btn-small">
          {t('detail.wiki')}
        </a>
      </footer>
    </article>
  );
}

function ChatLink({ code }: { code: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied('ok');
    } catch {
      setCopied('fail'); // e.g. without HTTPS in a home lab: then select manually
    }
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <span className="chat-link">
      <code onFocus={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)} tabIndex={0}>
        {code}
      </code>
      <button type="button" className="btn btn-small" onClick={() => void copy()}>
        {copied === 'ok' ? t('detail.copied') : copied === 'fail' ? t('detail.copyManual') : t('detail.copy')}
      </button>
    </span>
  );
}

function RawDetails({ details }: { details: Record<string, unknown> | null }) {
  const { t } = useT();
  if (!details) return null;
  return (
    <details className="panel raw-details">
      <summary>{t('detail.raw')}</summary>
      <pre>{JSON.stringify(details, null, 2)}</pre>
    </details>
  );
}
