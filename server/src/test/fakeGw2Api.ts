// Local stand-in for api.guildwars2.com in tests.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Gw2Item } from '../gw2/client.js';

export interface FakeGw2Api {
  url: string;
  items: Map<number, Gw2Item>;
  /** IDs that /v2/items lists but for which there are no details (-> 206 Partial Content). */
  ghostIds: number[];
  buildId: number | null;
  /** German texts per ID for lang=de. Without an entry (or field) the API returns the English text. */
  german: Map<number, { name?: string; description?: string }>;
  /** If true, every request with lang=de responds with 500 (English requests work normally). */
  failGerman: boolean;
  /** Status codes returned in order for the next requests (regardless of path). */
  failures: number[];
  requests: string[];
  close(): Promise<void>;
}

export async function startFakeGw2Api(items: Gw2Item[]): Promise<FakeGw2Api> {
  const api: FakeGw2Api = {
    url: '',
    items: new Map(items.map((item) => [item.id, structuredClone(item)])),
    ghostIds: [],
    buildId: 123456,
    german: new Map(),
    failGerman: false,
    failures: [],
    requests: [],
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections(); // keep-alive connections from fetch would stay open otherwise
      }),
  };

  const server = http.createServer((req, res) => {
    api.requests.push(req.url ?? '');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    const failure = api.failures.shift();
    if (failure !== undefined) return send(failure, { text: 'simulated failure' });

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/v2/build') {
      return api.buildId === null ? send(500, { text: 'no build' }) : send(200, { id: api.buildId });
    }
    if (url.pathname === '/v2/items') {
      const ids = url.searchParams.get('ids');
      if (!ids) return send(200, [...api.items.keys(), ...api.ghostIds]);
      const requested = ids.split(',').map(Number);
      const lang = url.searchParams.get('lang');
      if (lang === 'de' && api.failGerman) return send(500, { text: 'german down' });
      const found = requested
        .map((id) => api.items.get(id))
        .filter((item) => item !== undefined)
        .map((item) => (lang === 'de' ? { ...item, ...api.german.get(item.id) } : item));
      if (found.length === 0) return send(404, { text: 'all ids provided are invalid' });
      return send(found.length < requested.length ? 206 : 200, found);
    }
    send(404, { text: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  api.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return api;
}
