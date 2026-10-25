/**
 * Renders parsed help-article blocks (src/lib/help-markdown.ts) as React
 * elements — never as raw HTML. `help:<slug>` links resolve under `basePath`.
 */
import Link from 'next/link';
import { Info } from 'lucide-react';
import type { Block, Inline } from '@/lib/help-markdown';
import { splitHighlight } from '@/lib/help-markdown';

function resolveHref(href: string, basePath: string): string {
  return href.startsWith('help:') ? `${basePath}/${href.slice(5)}` : href;
}

function InlineView({ inline, basePath }: { inline: Inline[]; basePath: string }) {
  return (
    <>
      {inline.map((i, idx) => {
        switch (i.t) {
          case 'bold':
            return <strong key={idx} className="font-semibold text-foreground">{i.v}</strong>;
          case 'italic':
            return <em key={idx}>{i.v}</em>;
          case 'code':
            return <code key={idx} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{i.v}</code>;
          case 'link': {
            const href = resolveHref(i.href, basePath);
            return href.startsWith('/') ? (
              <Link key={idx} href={href} className="text-primary underline underline-offset-2">{i.v}</Link>
            ) : (
              <a key={idx} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{i.v}</a>
            );
          }
          default:
            return <span key={idx}>{i.v}</span>;
        }
      })}
    </>
  );
}

export function HelpMarkdownView({ blocks, basePath }: { blocks: Block[]; basePath: string }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-muted-foreground break-words">
      {blocks.map((b, idx) => {
        switch (b.type) {
          case 'h2':
            return <h2 key={idx} className="display pt-2 text-lg font-semibold text-foreground"><InlineView inline={b.inline} basePath={basePath} /></h2>;
          case 'h3':
            return <h3 key={idx} className="pt-1 text-base font-semibold text-foreground"><InlineView inline={b.inline} basePath={basePath} /></h3>;
          case 'note':
            return (
              <div key={idx} className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <p><InlineView inline={b.inline} basePath={basePath} /></p>
              </div>
            );
          case 'ul':
          case 'ol': {
            const Tag = b.type;
            return (
              <Tag key={idx} className={b.type === 'ul' ? 'list-disc space-y-1 pl-5' : 'list-decimal space-y-1 pl-5'}>
                {b.items.map((it, j) => <li key={j}><InlineView inline={it} basePath={basePath} /></li>)}
              </Tag>
            );
          }
          default:
            return <p key={idx}><InlineView inline={b.inline} basePath={basePath} /></p>;
        }
      })}
    </div>
  );
}

/** Text with ⟦…⟧ search-highlight markers rendered as <mark>. */
export function Highlighted({ text }: { text: string }) {
  return (
    <>
      {splitHighlight(text).map((s, i) =>
        s.hit ? <mark key={i} className="rounded bg-primary/15 px-0.5 text-foreground">{s.v}</mark> : <span key={i}>{s.v}</span>
      )}
    </>
  );
}
