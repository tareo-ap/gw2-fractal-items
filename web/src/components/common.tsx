import { useState, type ReactNode } from 'react';
import type { GameType, Rarity, TestStatus } from '../../../shared/types';
import { linkHandler, withBase } from '../lib/router';
import { useT } from '../lib/i18n';
import { rarityClass } from '../lib/format';

// Shared small UI components. In React a component is a function that takes props (one object) and returns JSX
// (HTML-like syntax that compiles to function calls). `children` is whatever is nested between the opening and closing
// tag.

/** Internal link: a real <a href> (so open-in-new-tab works) whose normal click navigates without a page reload. */
export function Link({
    href,
    className,
    title,
    children,
}: {
    href: string;
    className?: string;
    title?: string;
    children: ReactNode; // ReactNode = anything React can render (elements, text, arrays, null)
}) {
    return (
        <a href={withBase(href)} className={className} title={title} onClick={linkHandler(href)}>
            {children}
        </a>
    );
}

/** Item icon with a border in the rarity color; a placeholder if there is no icon or loading fails. */
export function ItemIcon({
    icon,
    rarity,
    name,
    size = 40,
}: {
    icon: string | null;
    rarity: Rarity;
    name: string;
    size?: number;
}) {
    // useState: [value, setter]; setting it re-renders. Here: remember that the <img> failed to load.
    const [failed, setFailed] = useState(false);
    const style = { width: size, height: size };
    return (
        <span className={`item-icon ${rarityClass(rarity)}`} style={style}>
            {/* The placeholder always sits underneath: visible while loading, without an icon and on load errors. */}
            <span className="item-icon-placeholder" aria-hidden="true">
                {name.charAt(0).toUpperCase() || '?'}
            </span>
            {icon && !failed && (
                <img src={icon} alt="" loading="lazy" width={size} height={size} onError={() => setFailed(true)} />
            )}
        </span>
    );
}

/**
 * Badges for an item's game types (where it may be used); Dungeon is highlighted since it makes an item a candidate.
 */
export function GameTypeBadges({ gameTypes }: { gameTypes: GameType[] }) {
    if (gameTypes.length === 0) return <span className="muted">–</span>;
    return (
        <span className="badges">
            {gameTypes.map((gameType) => (
                <span key={gameType} className={gameType === 'Dungeon' ? 'badge badge-dungeon' : 'badge'}>
                    {gameType}
                </span>
            ))}
        </span>
    );
}

/** Manual test result of an item (untested/works/broken), plus a marker if a retest is due after a later change. */
export function TestBadge({ status, needsRetest }: { status: TestStatus; needsRetest: boolean }) {
    const { t } = useT(); // t(key) = translated UI text
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

/** Error message with an optional retry button. */
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

/** Spinner with a loading text (default text from i18n). */
export function Loading({ text }: { text?: string }) {
    const { t } = useT();
    return (
        <div className="loading" role="status">
            <span className="spinner" aria-hidden="true" />
            {text ?? t('common.loading')}
        </div>
    );
}

/**
 * Shows gained (+) and lost (−) game_types; renders nothing if both lists are equal.
 * `key` lets React track list items.
 */
export function GameTypeDiff({ before, after }: { before: GameType[]; after: GameType[] }) {
    const gained = after.filter((gameType) => !before.includes(gameType));
    const lost = before.filter((gameType) => !after.includes(gameType));
    if (gained.length === 0 && lost.length === 0) return null;
    return (
        <span className="gt-diff">
            {gained.map((gameType) => (
                <span key={`+${gameType}`} className={`badge gt-gained ${gameType === 'Dungeon' ? 'gt-dungeon' : ''}`}>
                    +{gameType}
                </span>
            ))}
            {lost.map((gameType) => (
                <span key={`-${gameType}`} className={`badge gt-lost ${gameType === 'Dungeon' ? 'gt-dungeon' : ''}`}>
                    −{gameType}
                </span>
            ))}
        </span>
    );
}
