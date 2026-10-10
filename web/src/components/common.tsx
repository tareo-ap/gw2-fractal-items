import { useState, type ReactNode } from 'react';
import type { GameType, Rarity, TestStatus } from '../../../shared/types';
import { linkHandler } from '../lib/router';
import { TEST_LABELS, rarityClass } from '../lib/format';

export function Link({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} className={className} onClick={linkHandler(href)}>
      {children}
    </a>
  );
}

/** Item-Icon mit Rahmen in Seltenheitsfarbe; ohne Icon oder bei Ladefehler ein Platzhalter. */
export function ItemIcon({ icon, rarity, name, size = 40 }: { icon: string | null; rarity: Rarity; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  return (
    <span className={`item-icon ${rarityClass(rarity)}`} style={style}>
      {/* Platzhalter liegt immer darunter: sichtbar beim Laden, ohne Icon und bei Ladefehlern. */}
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
  return (
    <span className="badges">
      <span className={`badge test-${status}`}>{TEST_LABELS[status]}</span>
      {needsRetest && (
        <span className="badge badge-retest" title="game_types haben sich seit dem Test geändert">
          neu testen
        </span>
      )}
    </span>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Erneut versuchen
        </button>
      )}
    </div>
  );
}

export function Loading({ text = 'Lade …' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {text}
    </div>
  );
}

/** Zeigt gewonnene (+) und verlorene (−) game_types. */
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
