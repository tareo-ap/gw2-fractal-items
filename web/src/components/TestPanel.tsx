import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ItemDetail, TestStatus } from '../../../shared/types';
import { api } from '../api';
import { TEST_LABELS, formatDateTime } from '../lib/format';
import { GameTypeDiff } from './common';

const STATUSES: TestStatus[] = ['untested', 'works', 'broken'];

/** Teststatus mit Notiz setzen (PUT /api/items/:id/test). */
export function TestPanel({ item }: { item: ItemDetail }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TestStatus>(item.test.status);
  const [note, setNote] = useState(item.test.note ?? '');
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.setTest(item.id, { status, note: note.trim() || null }),
    onMutate: () => setSaved(false),
    onSuccess: async () => {
      setSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['item', item.id] }),
        queryClient.invalidateQueries({ queryKey: ['items'] }),
      ]);
    },
  });

  const dirty = status !== item.test.status || note.trim() !== (item.test.note ?? '').trim();

  return (
    <section className="panel test-panel">
      <h2>Teststatus</h2>
      {item.needsRetest && (
        <div className="warning" role="alert">
          <strong>Neu testen:</strong> Die game_types haben sich seit dem letzten Test geändert.
          <GameTypeDiff before={item.test.gameTypesAtTest ?? []} after={item.gameTypes} />
        </div>
      )}
      <p className="small muted">
        {item.test.testedAt ? `Zuletzt getestet: ${formatDateTime(item.test.testedAt)}` : 'Noch nicht getestet.'}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="segmented status-choice" role="radiogroup" aria-label="Status">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              className={status === s ? `active test-${s}` : ''}
              onClick={() => {
                setStatus(s);
                setSaved(false);
              }}
            >
              {TEST_LABELS[s]}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field-label">Notiz</span>
          <textarea
            value={note}
            rows={3}
            onChange={(e) => {
              setNote(e.target.value);
              setSaved(false);
            }}
            placeholder="z. B. in welchem Fraktal getestet, Auffälligkeiten"
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={save.isPending || (!dirty && !item.needsRetest)}>
            {save.isPending ? 'Speichere …' : 'Speichern'}
          </button>
          {saved && !dirty && <span className="small success">Gespeichert</span>}
          {save.isError && <span className="small error">Fehler: {save.error.message}</span>}
        </div>
        {item.needsRetest && !dirty && (
          <p className="small muted">Speichern ohne Änderung bestätigt den Status für die aktuellen game_types.</p>
        )}
      </form>
    </section>
  );
}
