import type { ItemChange } from '../../../shared/types';
import { CHANGE_LABELS, formatDateTime } from '../lib/format';
import { GameTypeDiff, Link } from './common';

/** Änderungsverlauf eines Items, neueste zuerst; game_types-Änderungen hervorgehoben. */
export function HistoryList({ history }: { history: ItemChange[] }) {
  if (history.length === 0) return <p className="small muted">Keine Änderungen erfasst.</p>;
  return (
    <ol className="history">
      {history.map((change) => {
        const gameTypesChanged = change.changedFields.includes('game_types') || change.kind !== 'changed';
        const dungeonChanged =
          (change.gameTypesBefore?.includes('Dungeon') ?? false) !== (change.gameTypesAfter?.includes('Dungeon') ?? false);
        return (
          <li key={`${change.updateId}-${change.kind}`} className={dungeonChanged ? 'history-entry dungeon-change' : 'history-entry'}>
            <div className="history-head">
              <span className={`badge change-${change.kind}`}>{CHANGE_LABELS[change.kind]}</span>
              <Link href={`/?view=all&candidate=all&includeRemoved=true&updateId=${change.updateId}`} className="small">
                {formatDateTime(change.updateStartedAt)}
              </Link>
            </div>
            {gameTypesChanged && (change.gameTypesBefore || change.gameTypesAfter) && (
              <GameTypeDiff before={change.gameTypesBefore ?? []} after={change.gameTypesAfter ?? []} />
            )}
            {change.kind === 'changed' && change.changedFields.length > 0 && (
              <div className="small muted">Felder: {change.changedFields.join(', ')}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
