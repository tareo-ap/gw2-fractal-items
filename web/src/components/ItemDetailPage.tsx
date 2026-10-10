import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ItemDetail } from '../../../shared/types';
import { api, ApiError } from '../api';
import { formatCoins, rarityClass } from '../lib/format';
import { ErrorBox, GameTypeBadges, ItemIcon, Link, Loading } from './common';
import { Gw2Text } from './Gw2Text';
import { HistoryList } from './HistoryList';
import { TestPanel } from './TestPanel';

export function ItemDetailPage({ id, backHref }: { id: number; backHref: string }) {
  const item = useQuery({
    queryKey: ['item', id],
    queryFn: () => api.item(id),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  return (
    <div className="detail-page">
      <Link href={backHref} className="back-link">
        ← Zurück zur Liste
      </Link>
      {item.isPending && <Loading text="Lade Item …" />}
      {item.isError &&
        (item.error instanceof ApiError && item.error.status === 404 ? (
          <ErrorBox message={`Item #${id} wurde nicht gefunden.`} />
        ) : (
          <ErrorBox message={`Item konnte nicht geladen werden: ${item.error.message}`} onRetry={() => void item.refetch()} />
        ))}
      {item.data && (
        <div className="detail-layout">
          <div className="detail-main">
            <Tooltip item={item.data} />
            <RawDetails details={item.data.details} />
          </div>
          <div className="detail-side">
            {/* key: Formular beim Wechsel auf ein anderes Item zurücksetzen */}
            <TestPanel key={item.data.id} item={item.data} />
            <section className="panel">
              <h2>Änderungsverlauf</h2>
              <HistoryList history={item.data.history} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/** Kasten im Stil des Ingame-Tooltips. */
function Tooltip({ item }: { item: ItemDetail }) {
  return (
    <article className={`tooltip ${rarityClass(item.rarity)} ${item.removed ? 'removed' : ''}`}>
      <header className="tooltip-head">
        <ItemIcon icon={item.icon} rarity={item.rarity} name={item.name} size={64} />
        <div>
          <h1 className="item-name tooltip-name">{item.name || `#${item.id}`}</h1>
          <div className="small muted">
            #{item.id}
            {item.removed && <span className="badge badge-removed">nicht mehr in der API</span>}
          </div>
        </div>
      </header>

      {item.description && (
        <p className="tooltip-desc">
          <Gw2Text text={item.description} />
        </p>
      )}

      <dl className="tooltip-props">
        <dt>Typ</dt>
        <dd>
          {item.type}
          {item.subtype && ` · ${item.subtype}`}
        </dd>
        <dt>Seltenheit</dt>
        <dd className="item-name">{item.rarity}</dd>
        <dt>Level</dt>
        <dd>{item.level}</dd>
        <dt>Game Types</dt>
        <dd>
          <GameTypeBadges gameTypes={item.gameTypes} />
          {item.isCandidate && <span className="small candidate-hint"> Fractal-Kandidat</span>}
        </dd>
        <dt>Flags</dt>
        <dd>{item.flags.length ? item.flags.join(', ') : '–'}</dd>
        <dt>Restrictions</dt>
        <dd>{item.restrictions.length ? item.restrictions.join(', ') : '–'}</dd>
        <dt>Händlerwert</dt>
        <dd>{formatCoins(item.vendorValue)}</dd>
      </dl>

      <footer className="tooltip-foot">
        {item.chatLink && <ChatLink code={item.chatLink} />}
        <a href={item.wikiUrl} target="_blank" rel="noreferrer noopener" className="btn btn-small">
          Im Wiki öffnen ↗
        </a>
      </footer>
    </article>
  );
}

function ChatLink({ code }: { code: string }) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied('ok');
    } catch {
      setCopied('fail'); // z. B. ohne HTTPS im Homelab: dann manuell markieren
    }
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <span className="chat-link">
      <code onFocus={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)} tabIndex={0}>
        {code}
      </code>
      <button type="button" className="btn btn-small" onClick={() => void copy()}>
        {copied === 'ok' ? 'Kopiert ✓' : copied === 'fail' ? 'Bitte manuell kopieren' : 'Kopieren'}
      </button>
    </span>
  );
}

function RawDetails({ details }: { details: Record<string, unknown> | null }) {
  if (!details) return null;
  return (
    <details className="panel raw-details">
      <summary>Rohdaten (details)</summary>
      <pre>{JSON.stringify(details, null, 2)}</pre>
    </details>
  );
}
