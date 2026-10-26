/**
 * Help-center markdown → typed blocks.
 *
 * Help articles are written in a deliberately small markdown subset so the
 * same parsed structure can be rendered by the web (React elements, never raw
 * HTML) and by the rider app (React Native <Text>), and returned as JSON by
 * the rider API. Supported:
 *
 *   ## Heading / ### Subheading, paragraphs, "- " bullets, "1. " numbered
 *   items, "> " notes, **bold**, *italic*, `code`, [text](url) and
 *   [text](help:<slug>) cross-links.
 *
 * Anything else is kept as literal text. Links are restricted to http(s),
 * relative paths, mailto/tel and help: — so `javascript:` can never become
 * a clickable href.
 *
 * Pure module (no server imports) — safe in client components and tests.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string };

export type Block =
  | { type: 'h2' | 'h3' | 'p' | 'note'; inline: Inline[] }
  | { type: 'ul' | 'ol'; items: Inline[][] };

const SAFE_HREF = /^(https?:\/\/|\/(?!\/)|mailto:|tel:|help:[a-z0-9-]+$)/i;

export function safeHref(href: string): string | null {
  const h = href.trim();
  return SAFE_HREF.test(h) ? h : null;
}

const INLINE_RE = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ t: 'text', v: src.slice(last, idx) });
    if (m[1] !== undefined) out.push({ t: 'bold', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'italic', v: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'code', v: m[3] });
    else {
      const href = safeHref(m[5]);
      out.push(href ? { t: 'link', v: m[4], href } : { t: 'text', v: m[4] });
    }
    last = idx + m[0].length;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}

export function parseHelpMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: Inline[][] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', inline: parseInline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara();
      flushList();
      blocks.push({ type: m[1].length === 3 ? 'h3' : 'h2', inline: parseInline(m[2]) });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      flushList();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === 'note') prev.inline.push({ t: 'text', v: ' ' }, ...parseInline(m[1]));
      else blocks.push({ type: 'note', inline: parseInline(m[1]) });
    } else if ((m = line.match(/^[-*]\s+(.*)$/)) || (m = line.match(/^\d+[.)]\s+(.*)$/))) {
      flushPara();
      const type = /^\d/.test(line) ? 'ol' : 'ul';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(parseInline(m[1]));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain text (for previews / meta descriptions). */
export function inlineText(inline: Inline[]): string {
  return inline.map((i) => i.v).join('');
}

/**
 * Search snippets come back from Postgres ts_headline with these sentinel
 * markers around matches. Clients split on them and render <mark>/<Text bold>
 * themselves — the snippet is never injected as HTML.
 */
export const HL_START = '⟦'; // ⟦
export const HL_END = '⟧'; // ⟧

export function splitHighlight(s: string): { v: string; hit: boolean }[] {
  const out: { v: string; hit: boolean }[] = [];
  const re = new RegExp(`${HL_START}([^${HL_END}]*)${HL_END}`, 'g');
  let last = 0;
  for (const m of s.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ v: s.slice(last, idx), hit: false });
    out.push({ v: m[1], hit: true });
    last = idx + m[0].length;
  }
  if (last < s.length) out.push({ v: s.slice(last), hit: false });
  return out;
}
