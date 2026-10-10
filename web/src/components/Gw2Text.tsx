import type { ReactNode } from 'react';

// Rendert GW2-Beschreibungen sicher als React-Elemente (kein innerHTML).
// Unterstützt: <c=@flavor>…</c> bzw. <c=#hex>…</c> → <span class="gw2-c-…">, <br> und \n → Zeilenumbruch.
// Alle anderen Tags werden entfernt, ihr Text bleibt stehen.

interface Node {
  className: string | null;
  children: ReactNode[];
}

const TAG = /<\s*(\/?)\s*([a-z]+)\s*(?:=\s*([@#]?[\w-]+))?\s*\/?\s*>/gi;

function pushText(target: ReactNode[], text: string, key: () => string) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (i > 0) target.push(<br key={key()} />);
    if (line) target.push(line);
  });
}

export function parseGw2Markup(text: string): ReactNode[] {
  let counter = 0;
  const key = () => `m${counter++}`;
  const root: Node = { className: null, children: [] };
  const stack: Node[] = [root];
  const top = () => stack[stack.length - 1] ?? root;

  let last = 0;
  for (const match of text.matchAll(TAG)) {
    pushText(top().children, text.slice(last, match.index), key);
    last = match.index + match[0].length;
    const [, closing, rawName = '', value] = match;
    const name = rawName.toLowerCase();

    if (name === 'br') {
      top().children.push(<br key={key()} />);
    } else if (name === 'c' && !closing) {
      // @flavor → gw2-c-flavor; Hex-Farben werden nicht übernommen, nur als "gw2-c-color" markiert.
      const cls = value?.startsWith('@') ? `gw2-c-${value.slice(1).toLowerCase().replace(/[^a-z0-9-]/g, '')}` : 'gw2-c-color';
      stack.push({ className: cls, children: [] });
    } else if (name === 'c' && closing && stack.length > 1) {
      const node = stack.pop()!;
      top().children.push(
        <span key={key()} className={node.className ?? undefined}>
          {node.children}
        </span>,
      );
    }
    // Unbekannte Tags: ignorieren.
  }
  pushText(top().children, text.slice(last), key);

  // Nicht geschlossene <c>-Tags trotzdem ausgeben.
  while (stack.length > 1) {
    const node = stack.pop()!;
    top().children.push(
      <span key={key()} className={node.className ?? undefined}>
        {node.children}
      </span>,
    );
  }
  return root.children;
}

export function Gw2Text({ text, className }: { text: string; className?: string }) {
  return <span className={className}>{parseGw2Markup(text)}</span>;
}
