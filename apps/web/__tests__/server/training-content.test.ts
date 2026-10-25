import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline } from '@/lib/training-markdown';
import {
  legacyToLessons,
  lessonsToLegacyBlocks,
  localizeLesson,
  localizeModuleText,
  localizeQuestion,
  normalizeLang,
} from '@/server/training/content';
import { ModuleContentSchema } from '@/server/training/authoring';
import { csvField, reportToCsv, type TrainingReport } from '@/server/training/report';
import { RIDER_MODULES } from '@/server/training/seed-content/rider';
import { STAFF_MODULES } from '@/server/training/seed-content/staff';

describe('training markdown', () => {
  it('parses headings, lists, paragraphs and images', () => {
    const b = parseMarkdown('## Title\n\nHello **bold** and *it*.\n\n- a\n- b\n\n1. one\n2. two\n\n![Helmet](https://x.test/h.png)');
    expect(b.map((x) => x.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'image']);
    expect(b[2]).toMatchObject({ ordered: false });
    expect(b[3]).toMatchObject({ ordered: true });
  });

  it('never emits unsafe links or images', () => {
    expect(parseInline('[x](javascript:alert(1))').some((s) => s.t === 'link')).toBe(false);
    expect(parseInline('[x](javascript:void)')).toEqual([{ t: 'text', v: 'x' }]);
    expect(parseMarkdown('![x](javascript:void)')).toEqual([]);
    expect(parseMarkdown('![x](javascript:alert(1))').some((b) => b.type === 'image')).toBe(false);
    expect(parseInline('<script>alert(1)</script>')).toEqual([{ t: 'text', v: '<script>alert(1)</script>' }]);
  });
});

describe('legacy conversion', () => {
  it('splits block content into lessons at headings and lifts quiz + checklist blocks', () => {
    const { lessons, questions } = legacyToLessons({
      title: 'Old module',
      contentBlocks: [
        { id: '1', type: 'paragraph', text: 'Intro text' },
        { id: '2', type: 'heading', text: 'Part two' },
        { id: '3', type: 'callout', tone: 'tip', title: 'Tip', body: 'Be nice' },
        { id: '4', type: 'checklist', title: 'Before you go', items: ['Helmet', 'Phone'] },
        { id: '5', type: 'quiz', question: 'Helmet?', options: ['Yes', 'No'], correct: 0 },
      ],
      contentBody: 'ignored',
      quizQuestions: [{ question: 'Legacy Q', options: ['a', 'b', 'c'], answer: 2 }],
    });
    expect(lessons.map((l) => [l.kind, l.title])).toEqual([
      ['TEXT', 'Old module'],
      ['TEXT', 'Part two'],
      ['CHECKLIST', 'Before you go'],
    ]);
    expect(questions).toHaveLength(2);
    expect(questions[1]).toMatchObject({ prompt: 'Legacy Q', correctIndex: 2 });
  });

  it('falls back to the plain body', () => {
    const { lessons } = legacyToLessons({ title: 'T', contentBlocks: null, contentBody: '# Hi\nthere', quizQuestions: null });
    expect(lessons).toEqual([{ kind: 'TEXT', title: 'T', body: '# Hi\nthere' }]);
  });

  it('lessons → legacy blocks for pre-v2 app builds (incl. quiz)', () => {
    const blocks = lessonsToLegacyBlocks(
      [
        { kind: 'TEXT', title: 'L1', body: '## Sub\n\nPara\n\n- a\n- b' },
        { kind: 'CHECKLIST', title: 'L2', body: '', checklistItems: ['x'] },
        { kind: 'VIDEO', title: 'L3', body: '', mediaUrl: 'https://v.test/1' },
      ],
      [{ prompt: 'Q?', options: ['a', 'b'], correctIndex: 1 }],
    );
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'heading', 'paragraph', 'keyPoints', 'heading', 'checklist', 'heading', 'callout', 'quiz']);
    expect(blocks.at(-1)).toMatchObject({ type: 'quiz', correct: 1 });
  });
});

describe('localization', () => {
  it('falls back field by field and never leaks answers', () => {
    expect(normalizeLang('hi')).toBe('hi');
    expect(normalizeLang('fr')).toBe('en');
    expect(localizeModuleText({ title: 'T', summary: 'S', translations: { hi: { title: 'टी' } } }, 'hi')).toEqual({ title: 'टी', summary: 'S' });
    const l = localizeLesson(
      { id: 'l', order: 0, kind: 'CHECKLIST', title: 'T', body: 'B', mediaUrl: null, checklistItems: ['a', 'b'], translations: { hi: { checklistItems: ['क'] } } },
      'hi',
    );
    expect(l.checklistItems).toEqual(['a', 'b']); // mismatched count → base items
    const q = localizeQuestion(
      { id: 'q', order: 0, prompt: 'P', options: ['a', 'b'], correctIndex: 1, explanation: 'E', translations: { hi: { prompt: 'प', options: ['अ', 'ब'] } } },
      'hi',
    );
    expect(q).toEqual({ id: 'q', order: 0, prompt: 'प', options: ['अ', 'ब'] });
    expect(q).not.toHaveProperty('correctIndex');
  });
});

describe('starter library', () => {
  const all = [...RIDER_MODULES, ...STAFF_MODULES];

  it('covers every requested topic with unique slugs', () => {
    expect(new Set(all.map((m) => m.slug)).size).toBe(all.length);
    expect(RIDER_MODULES.length).toBe(7);
    expect(STAFF_MODULES.filter((m) => m.audience === 'KITCHEN').length).toBe(4);
    expect(STAFF_MODULES.filter((m) => m.audience === 'RESTAURANT_ADMIN').length).toBe(3);
    expect(RIDER_MODULES.every((m) => m.audience === 'RIDER')).toBe(true);
  });

  it.each(all.map((m) => [m.slug, m] as const))('%s: 3-6 lessons, 5 questions, valid for the editor schema', (_slug, m) => {
    expect(m.lessons.length).toBeGreaterThanOrEqual(3);
    expect(m.lessons.length).toBeLessThanOrEqual(6);
    expect(m.questions).toHaveLength(5);
    const parsed = ModuleContentSchema.safeParse({ ...m, translations: m.translations ?? null });
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues[0])).toBe(true);
    for (const q of m.questions) {
      const hi = q.translations?.hi;
      if (hi?.options) expect(hi.options).toHaveLength(q.options.length);
    }
    for (const l of m.lessons) {
      expect(l.kind === 'TEXT' || l.kind === 'CHECKLIST').toBe(true);
      expect(/lorem ipsum/i.test(l.body)).toBe(false);
    }
  });

  it('ships Hindi for the required rider safety modules', () => {
    for (const slug of ['rider-road-safety-helmet', 'rider-food-hygiene-transit']) {
      const m = all.find((x) => x.slug === slug)!;
      expect(m.translations?.hi?.title).toBeTruthy();
      expect(m.lessons.every((l) => !!l.translations?.hi?.body)).toBe(true);
    }
  });

  it('only the road-safety module blocks shifts', () => {
    expect(all.filter((m) => m.blocksShift).map((m) => m.slug)).toEqual(['rider-road-safety-helmet']);
  });
});

describe('CSV export', () => {
  it('quotes and neutralises formula injection', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+91 98')).toBe("'+91 98");
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField(null)).toBe('');
  });

  it('emits one row per learner x assigned module', () => {
    const report: TrainingReport = {
      generatedAt: '2026-10-24T00:00:00.000Z',
      modules: [
        { id: 'm1', title: 'Road safety', audience: 'RIDER', isRequired: true, isActive: true, version: 2, learners: 1, certified: 0, attempts: 1, passedAttempts: 0, passRatePct: 0, avgScorePct: 40, overdue: 1 },
        { id: 'm2', title: 'KOT', audience: 'KITCHEN', isRequired: true, isActive: true, version: 1, learners: 0, certified: 0, attempts: 0, passedAttempts: 0, passRatePct: null, avgScorePct: null, overdue: 0 },
      ],
      learners: [
        {
          userId: 'u1', name: 'Ravi', phone: '+919000000001', audience: 'RIDER', restaurant: null, requiredTotal: 1, requiredCertified: 0, overdue: 1,
          cells: {
            m1: { state: 'RECERT_REQUIRED', overdue: true, bestScorePct: 40, certifiedAt: '2026-10-01T00:00:00.000Z', certVersion: 1, attempts: 1, dueAt: '2026-10-08T00:00:00.000Z' },
            m2: { state: 'NOT_ASSIGNED', overdue: false, bestScorePct: null, certifiedAt: null, certVersion: null, attempts: 0, dueAt: null },
          },
        },
      ],
    };
    const lines = reportToCsv(report).trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("Ravi,'+919000000001,RIDER,,Road safety,RIDER,Yes,2,Re-certification required,Yes,2026-10-08,40,1,1,2026-10-01");
  });
});
