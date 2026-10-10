import { useQuery } from '@tanstack/react-query';
import { api } from './api';

// Startseite für Meilenstein 1: zeigt nur, dass Frontend, Backend und Datenbank zusammenspielen.
export function App() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });

  return (
    <div className="app">
      <header className="app-header">
        <h1>GW2 Fractal Items</h1>
      </header>
      <main className="content">
        {stats.isPending && <p className="muted">Lade …</p>}
        {stats.isError && <p className="error">Backend nicht erreichbar: {stats.error.message}</p>}
        {stats.data && (
          <div className="stat-grid">
            <Stat label="Items gesamt" value={stats.data.items} />
            <Stat label="Gizmo-Kandidaten" value={stats.data.candidates.gizmo} />
            <Stat label="Consumable-Kandidaten" value={stats.data.candidates.consumable} />
            <Stat
              label="Letztes Update"
              value={stats.data.lastUpdate ? new Date(stats.data.lastUpdate.startedAt).toLocaleString('de-DE') : 'noch keins'}
            />
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{typeof value === 'number' ? value.toLocaleString('de-DE') : value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
