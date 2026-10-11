import type { ReactNode } from 'react';

// Renders GW2 descriptions safely as React elements (no innerHTML).
// Supports: <c=@flavor>…</c> and <c=#hex>…</c> -> <span class="gw2-c-…">, <br> and \n -> line break.
// All other tags are removed, their text is kept.

interface MarkupNode {
    className: string | null;
    children: ReactNode[];
}

// Matches one tag such as <c=@flavor>, </c> or <br>: groups = closing slash, tag name, optional value.
const TAG = /<\s*(\/?)\s*([a-z]+)\s*(?:=\s*([@#]?[\w-]+))?\s*\/?\s*>/gi;

// Appends plain text to `target`, turning newlines into <br>. `key` supplies unique React keys for the generated
// elements.
function pushText(target: ReactNode[], text: string, key: () => string) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
        if (lineIndex > 0) target.push(<br key={key()} />);
        if (line) target.push(line);
    });
}

/** Converts GW2 description markup into React nodes; <c> tags nest, so a stack of open tags is kept. */
export function parseGw2Markup(text: string): ReactNode[] {
    let counter = 0; // React needs a unique key for every element in a list

    const key = () => `m${counter++}`;
    const root: MarkupNode = { className: null, children: [] };
    const stack: MarkupNode[] = [root];
    const currentNode = () => stack[stack.length - 1] ?? root;

    let lastTagEnd = 0;
    // Walk through all tags; the text between two tags is attached to the innermost open <c>.
    for (const match of text.matchAll(TAG)) {
        pushText(currentNode().children, text.slice(lastTagEnd, match.index), key);
        lastTagEnd = match.index + match[0].length;
        const [, closing, rawName = '', value] = match;
        const name = rawName.toLowerCase();

        if (name === 'br') {
            currentNode().children.push(<br key={key()} />);
        } else if (name === 'c' && !closing) {
            // @flavor -> gw2-c-flavor; hex colors are not taken over, only marked as "gw2-c-color".
            const spanClass = value?.startsWith('@')
                ? `gw2-c-${value
                      .slice(1)
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, '')}`
                : 'gw2-c-color';
            stack.push({ className: spanClass, children: [] });
        } else if (name === 'c' && closing && stack.length > 1) {
            const node = stack.pop()!;
            currentNode().children.push(
                <span key={key()} className={node.className ?? undefined}>
                    {node.children}
                </span>,
            );
        }
        // Unknown tags: ignore.
    }
    pushText(currentNode().children, text.slice(lastTagEnd), key);

    // Still output unclosed <c> tags.
    while (stack.length > 1) {
        const node = stack.pop()!;
        currentNode().children.push(
            <span key={key()} className={node.className ?? undefined}>
                {node.children}
            </span>,
        );
    }
    return root.children;
}

/** Component wrapper: renders a GW2 description as styled text inside a <span>. */
export function Gw2Text({ text, className }: { text: string; className?: string }) {
    return <span className={className}>{parseGw2Markup(text)}</span>;
}
