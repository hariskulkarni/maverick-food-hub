import { describe, it, expect } from 'vitest';
import { parseHelpMarkdown, parseInline, safeHref, splitHighlight, HL_START, HL_END } from '@/lib/help-markdown';

describe('parseHelpMarkdown', () => {
  it('parses headings, paragraphs, lists and notes', () => {
    const md = '## Title\n\nLine one\nline two\n\n- a\n- b\n\n1. first\n2. second\n\n> tip one\n> tip two\n### Sub';
    const b = parseHelpMarkdown(md);
    expect(b.map((x) => x.type)).toEqual(['h2', 'p', 'ul', 'ol', 'note', 'h3']);
    expect(b[1]).toEqual({ type: 'p', inline: [{ t: 'text', v: 'Line one line two' }] });
    expect(b[2]).toMatchObject({ type: 'ul', items: [[{ v: 'a' }], [{ v: 'b' }]] });
    expect(b[4]).toMatchObject({ type: 'note' });
  });

  it('parses inline bold/italic/code/links incl. help: links', () => {
    expect(parseInline('**B** *i* `c` [x](help:order-statuses) [y](/admin/orders)')).toEqual([
      { t: 'bold', v: 'B' },
      { t: 'text', v: ' ' },
      { t: 'italic', v: 'i' },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'c' },
      { t: 'text', v: ' ' },
      { t: 'link', v: 'x', href: 'help:order-statuses' },
      { t: 'text', v: ' ' },
      { t: 'link', v: 'y', href: '/admin/orders' },
    ]);
  });

  it('never produces a clickable javascript:/data: or protocol-relative link', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', 'vbscript:x']) {
      expect(safeHref(bad)).toBeNull();
      expect(parseInline(`[x](${bad})`).some((i) => i.t === 'link')).toBe(false);
    }
    expect(safeHref('https://flavrly.in')).toBe('https://flavrly.in');
  });

  it('keeps raw HTML as literal text (rendered escaped by React)', () => {
    const b = parseHelpMarkdown('<script>alert(1)</script>');
    expect(b).toEqual([{ type: 'p', inline: [{ t: 'text', v: '<script>alert(1)</script>' }] }]);
  });
});

describe('splitHighlight', () => {
  it('splits on server sentinels', () => {
    expect(splitHighlight(`a ${HL_START}b${HL_END} c`)).toEqual([
      { v: 'a ', hit: false },
      { v: 'b', hit: true },
      { v: ' c', hit: false },
    ]);
  });
});
