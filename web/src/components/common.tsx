import { useState, type ReactNode } from 'react';
import type { GameType, Rarity, TestStatus } from '../../../shared/types';
import { linkHandler, withBase } from '../lib/router';
import { useT } from '../lib/i18n';
import { rarityClass } from '../lib/format';

export function Link({ href, className, title, children }: { href: string; className?: string; title?: string; children: ReactNode }) {
  return (
    <a href={withBase(href)} className={className} title={title} onClick={linkHandler(href)}>
      {children}
    </a>
  );
}

/** Item icon with a border in the rarity color; a placeholder if there is no icon or loading fails. */
export function ItemIcon({ icon, rarity, name, size = 40 }: { icon: string | null; rarity: Rarity; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  return (
    <span className={`item-icon ${rarityClass(rarity)}`} style={style}>
      {/* The placeholder always sits underneath: visible while loading, without an icon and on load errors. */}
      <span className="item-icon-placeholder" aria-hidden="true">
        {name.charAt(0).toUpperCase() || '?'}
      </span>
      {icon && !failed && <img src={icon} alt="" loading="lazy" width={size} height={size} onError={() => setFailed(true)} />}
    </span>
  );
}

export function GameTypeBadges({ gameTypes }: { gameTypes: GameType[] }) {
  if (gameTypes.length === 0) return <span className="muted">–</span>;
  return (
    <span className="badges">
      {gameTypes.map((gt) => (
        <span key={gt} className={gt === 'Dungeon' ? 'badge badge-dungeon' : 'badge'}>
          {gt}
        </span>
      ))}
    </span>
  );
}

export function TestBadge({ status, needsRetest }: { status: TestStatus; needsRetest: boolean }) {
  const { t } = useT();
  return (
    <span className="badges">
      <span className={`badge test-${status}`}>{t(`test.${status}`)}</span>
      {needsRetest && (
        <span className="badge badge-retest" title={t('badge.retestTitle')}>
          {t('badge.retest')}
        </span>
      )}
    </span>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useT();
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Loading({ text }: { text?: string }) {
  const { t } = useT();
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {text ?? t('common.loading')}
    </div>
  );
}

/** Shows gained (+) and lost (−) game_types. */
export function GameTypeDiff({ before, after }: { before: GameType[]; after: GameType[] }) {
  const gained = after.filter((g) => !before.includes(g));
  const lost = before.filter((g) => !after.includes(g));
  if (gained.length === 0 && lost.length === 0) return null;
  return (
    <span className="gt-diff">
      {gained.map((g) => (
        <span key={`+${g}`} className={`badge gt-gained ${g === 'Dungeon' ? 'gt-dungeon' : ''}`}>
          +{g}
        </span>
      ))}
      {lost.map((g) => (
        <span key={`-${g}`} className={`badge gt-lost ${g === 'Dungeon' ? 'gt-dungeon' : ''}`}>
          −{g}
        </span>
      ))}
    </span>
  );
}
