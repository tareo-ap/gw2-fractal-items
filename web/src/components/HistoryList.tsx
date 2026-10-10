import type { ItemChange } from '../../../shared/types';
import { useT } from '../lib/i18n';
import { GameTypeDiff, Link } from './common';
import { utcStamp } from '../lib/format';

/** Änderungsverlauf eines Items, neueste zuerst; game_types-Änderungen hervorgehoben. */
export function HistoryList({ history }: { history: ItemChange[] }) {
  const { t } = useT();
  if (history.length === 0) return <p className="small muted">{t('history.empty')}</p>;
  return (
    <ol className="history">
      {history.map((change) => {
        const gameTypesChanged = change.changedFields.includes('game_types') || change.kind !== 'changed';
        const dungeonChanged =
          (change.gameTypesBefore?.includes('Dungeon') ?? false) !== (change.gameTypesAfter?.includes('Dungeon') ?? false);
        return (
          <li key={`${change.updateId}-${change.kind}`} className={dungeonChanged ? 'history-entry dungeon-change' : 'history-entry'}>
            <div className="history-head">
              <span className={`badge change-${change.kind}`}>{t(`change.${change.kind}`)}</span>
              <Link href={`/updates/${change.updateId}`} className="small">
                {utcStamp(change.updateStartedAt)} UTC
              </Link>
            </div>
            {gameTypesChanged && (change.gameTypesBefore || change.gameTypesAfter) && (
              <GameTypeDiff before={change.gameTypesBefore ?? []} after={change.gameTypesAfter ?? []} />
            )}
            {change.kind === 'changed' && change.changedFields.length > 0 && (
              <div className="small muted">{t('history.fields', { fields: change.changedFields.join(', ') })}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
