/**
 * Minimal markdown subset for training lessons — kept in step with
 * apps/web/src/lib/training-markdown.ts. Parsed to data; no HTML.
 */
export type InlineSpan =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'link'; v: string; href: string };

export type MdBlock =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; spans: InlineSpan[] }
  | { type: 'list'; ordered: boolean; items: InlineSpan[][] }
  | { type: 'image'; src: string; alt: string };

const SAFE_URL = /^https?:\/\//i;

export function parseInline(text: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'bold', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'italic', v: m[2] });
    else if (m[3] !== undefined) {
      out.push(SAFE_URL.test(m[4]) ? { t: 'link', v: m[3], href: m[4] } : { t: 'text', v: m[3] });
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

export function parseMarkdown(src: string): MdBlock[] {
  const lines = (src ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: InlineSpan[][] } | null = null;
  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', spans: parseInline(para.join(' ')) });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const num = /^\d+[.)]\s+(.+)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: 'heading', level: h[1].length === 2 ? 2 : 3, text: h[2].trim() });
    } else if (img) {
      flushPara();
      flushList();
      if (SAFE_URL.test(img[2])) blocks.push({ type: 'image', src: img[2], alt: img[1] });
    } else if (bullet || num) {
      flushPara();
      const ordered = !!num;
      const text = (bullet ?? num)![1];
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(parseInline(text));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}
