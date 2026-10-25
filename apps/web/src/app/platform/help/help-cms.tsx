'use client';
/**
 * Help-center authoring console (SUPER_ADMIN): articles (markdown editor with
 * live preview, publish/unpublish, version history + restore), categories,
 * and analytics (views, helpful %, top / zero-result searches).
 * Talks to /api/platform/help/*.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Eye, EyeOff, History, RotateCcw, Loader2, Search } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { reportApiError } from '@/lib/api-error';
import { parseHelpMarkdown } from '@/lib/help-markdown';
import { HelpMarkdownView } from '@/components/help/help-markdown-view';

const AUDIENCES = ['RESTAURANT_ADMIN', 'KITCHEN', 'RIDER', 'CUSTOMER', 'ALL'] as const;
type Audience = (typeof AUDIENCES)[number];
const AUDIENCE_LABEL: Record<Audience, string> = {
  RESTAURANT_ADMIN: 'Restaurant admin',
  KITCHEN: 'Kitchen',
  RIDER: 'Rider',
  CUSTOMER: 'Customer',
  ALL: 'Everyone',
};

interface Category {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  audience: Audience;
  sortOrder: number;
  articleCount?: number;
}

interface Article {
  id: string;
  slug: string;
  language: 'en' | 'hi';
  title: string;
  summary: string;
  body: string;
  audience: Audience[];
  tags: string[];
  status: 'DRAFT' | 'PUBLISHED';
  appArea: string | null;
  relatedSlugs: string[];
  sortOrder: number;
  version: number;
  viewCount: number;
  categoryId: string | null;
  updatedAt: string;
  feedbackCount?: number;
}

interface Version {
  id: string;
  version: number;
  title: string;
  summary: string;
  body: string;
  note: string | null;
  authorName: string | null;
  createdAt: string;
}

async function api<T>(url: string, init?: RequestInit, errPrefix = 'Request failed'): Promise<T | null> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!r.ok) {
    await reportApiError(r, errPrefix);
    return null;
  }
  return (await r.json()) as T;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function HelpCms() {
  const [categories, setCategories] = useState<Category[]>([]);
  const loadCategories = useCallback(async () => {
    const j = await api<{ categories: Category[] }>('/api/platform/help/categories', undefined, 'Could not load categories');
    if (j) setCategories(j.categories);
  }, []);
  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  return (
    <Tabs defaultValue="articles">
      <TabsList>
        <TabsTrigger value="articles">Articles</TabsTrigger>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
      </TabsList>
      <TabsContent value="articles" className="mt-4">
        <ArticlesPanel categories={categories} />
      </TabsContent>
      <TabsContent value="categories" className="mt-4">
        <CategoriesPanel categories={categories} reload={loadCategories} />
      </TabsContent>
      <TabsContent value="analytics" className="mt-4">
        <AnalyticsPanel />
      </TabsContent>
    </Tabs>
  );
}

// ─── Articles ───────────────────────────────────────────────────────────────

function ArticlesPanel({ categories }: { categories: Category[] }) {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [editing, setEditing] = useState<Article | 'new' | null>(null);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<'ALL' | 'DRAFT' | 'PUBLISHED'>('ALL');

  const load = useCallback(async () => {
    const j = await api<{ articles: Article[] }>('/api/platform/help/articles', undefined, 'Could not load articles');
    if (j) setArticles(j.articles);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.title])), [categories]);
  const shown = (articles ?? []).filter((a) => {
    if (status !== 'ALL' && a.status !== status) return false;
    const f = filter.trim().toLowerCase();
    return !f || a.title.toLowerCase().includes(f) || a.slug.includes(f) || (a.appArea ?? '').includes(f);
  });

  async function togglePublish(a: Article) {
    const j = await api<{ article: Article }>(
      `/api/platform/help/articles/${a.id}/publish`,
      { method: 'POST', body: JSON.stringify({ published: a.status !== 'PUBLISHED' }) },
      'Could not change status'
    );
    if (j) {
      toast.success(j.article.status === 'PUBLISHED' ? 'Published' : 'Unpublished');
      load();
    }
  }

  async function remove(a: Article) {
    if (!confirm(`Delete "${a.title}" (${a.language})? Its version history and feedback are deleted too.`)) return;
    const j = await api<{ ok: true }>(`/api/platform/help/articles/${a.id}`, { method: 'DELETE' }, 'Could not delete');
    if (j) {
      toast.success('Deleted');
      load();
    }
  }

  if (editing) {
    return (
      <ArticleEditor
        article={editing === 'new' ? null : editing}
        categories={categories}
        onClose={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title, slug or app area" className="pl-9" />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="h-10 rounded-md border bg-background px-3 text-sm"
          aria-label="Status filter"
        >
          <option value="ALL">All statuses</option>
          <option value="PUBLISHED">Published</option>
          <option value="DRAFT">Draft</option>
        </select>
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden /> New article
        </Button>
      </div>

      {articles === null ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : shown.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          {articles.length === 0 ? 'No articles yet. Create one, or run `npm run db:seed:help` to load the starter content.' : 'No articles match the filter.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Article</th>
                <th className="p-3">Category</th>
                <th className="p-3">Audience</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Views</th>
                <th className="p-3">Updated</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((a) => (
                <tr key={a.id}>
                  <td className="p-3">
                    <div className="font-medium">{a.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.slug} · {a.language} · v{a.version}
                      {a.appArea ? ` · ${a.appArea}` : ''}
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">{a.categoryId ? catName.get(a.categoryId) ?? '—' : '—'}</td>
                  <td className="p-3 text-xs text-muted-foreground">{a.audience.map((x) => AUDIENCE_LABEL[x]).join(', ')}</td>
                  <td className="p-3">
                    <Badge variant={a.status === 'PUBLISHED' ? 'success' : 'muted'}>{a.status === 'PUBLISHED' ? 'Published' : 'Draft'}</Badge>
                  </td>
                  <td className="p-3 text-right tabular-nums">{a.viewCount}</td>
                  <td className="p-3 text-xs text-muted-foreground">{fmt(a.updatedAt)}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" aria-label="Edit" title="Edit" onClick={() => setEditing(a)}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={a.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                        title={a.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                        onClick={() => togglePublish(a)}
                      >
                        {a.status === 'PUBLISHED' ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Delete" title="Delete" onClick={() => remove(a)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const csv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function ArticleEditor({ article, categories, onClose }: { article: Article | null; categories: Category[]; onClose: () => void }) {
  const [current, setCurrent] = useState<Article | null>(article);
  const [form, setForm] = useState({
    slug: article?.slug ?? '',
    language: article?.language ?? ('en' as 'en' | 'hi'),
    title: article?.title ?? '',
    summary: article?.summary ?? '',
    body: article?.body ?? '',
    audience: article?.audience ?? (['RESTAURANT_ADMIN'] as Audience[]),
    tags: article?.tags.join(', ') ?? '',
    appArea: article?.appArea ?? '',
    relatedSlugs: article?.relatedSlugs.join(', ') ?? '',
    categoryId: article?.categoryId ?? '',
    sortOrder: article?.sortOrder ?? 0,
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const blocks = useMemo(() => parseHelpMarkdown(form.body), [form.body]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save(publish?: boolean) {
    setSaving(true);
    const payload = {
      slug: form.slug.trim(),
      language: form.language,
      title: form.title,
      summary: form.summary,
      body: form.body,
      audience: form.audience,
      tags: csv(form.tags),
      appArea: form.appArea.trim() || null,
      relatedSlugs: csv(form.relatedSlugs),
      categoryId: form.categoryId || null,
      sortOrder: Number(form.sortOrder) || 0,
    };
    const j = current
      ? await api<{ article: Article }>(
          `/api/platform/help/articles/${current.id}`,
          { method: 'PATCH', body: JSON.stringify({ ...payload, note: form.note.trim() || undefined }) },
          'Could not save'
        )
      : await api<{ article: Article }>(
          '/api/platform/help/articles',
          { method: 'POST', body: JSON.stringify({ ...payload, publish: !!publish }) },
          'Could not create'
        );
    if (j && current && publish !== undefined && (j.article.status === 'PUBLISHED') !== publish) {
      const p = await api<{ article: Article }>(
        `/api/platform/help/articles/${current.id}/publish`,
        { method: 'POST', body: JSON.stringify({ published: publish }) },
        'Saved, but could not change status'
      );
      if (p) j.article = p.article;
    }
    setSaving(false);
    if (j) {
      setCurrent(j.article);
      set('note', '');
      toast.success(`Saved v${j.article.version}${j.article.status === 'PUBLISHED' ? ' (published)' : ' (draft)'}`);
    }
  }

  function toggleAudience(a: Audience) {
    set('audience', form.audience.includes(a) ? form.audience.filter((x) => x !== a) : [...form.audience, a]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onClose}>
          ← Back to articles
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {current && (
            <>
              <Badge variant={current.status === 'PUBLISHED' ? 'success' : 'muted'}>
                {current.status === 'PUBLISHED' ? 'Published' : 'Draft'} · v{current.version}
              </Badge>
              <Button variant="outline" onClick={() => setShowVersions((v) => !v)}>
                <History aria-hidden /> History
              </Button>
            </>
          )}
          <Button variant="outline" disabled={saving} onClick={() => save()}>
            {current ? 'Save' : 'Save draft'}
          </Button>
          <Button disabled={saving} onClick={() => save(current?.status === 'PUBLISHED' ? false : true)}>
            {current?.status === 'PUBLISHED' ? 'Save & unpublish' : 'Save & publish'}
          </Button>
        </div>
      </div>

      {showVersions && current && (
        <VersionHistory
          articleId={current.id}
          version={current.version}
          onRestored={(a) => {
            setCurrent(a);
            setForm((f) => ({ ...f, title: a.title, summary: a.summary, body: a.body, audience: a.audience, tags: a.tags.join(', '), appArea: a.appArea ?? '', categoryId: a.categoryId ?? '' }));
          }}
        />
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2">
          <Field label="Title">
            <Input value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Slug (lowercase-with-dashes)">
            <Input value={form.slug} maxLength={80} onChange={(e) => set('slug', e.target.value.toLowerCase())} />
          </Field>
          <Field label="Summary (shown in lists and search)" className="md:col-span-2">
            <Input value={form.summary} maxLength={300} onChange={(e) => set('summary', e.target.value)} />
          </Field>
          <Field label="Category">
            <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({AUDIENCE_LABEL[c.audience]})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Language">
            <select value={form.language} onChange={(e) => set('language', e.target.value as 'en' | 'hi')} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </select>
          </Field>
          <Field label="Audience" className="md:col-span-2">
            <div className="flex flex-wrap gap-2">
              {AUDIENCES.map((a) => (
                <label key={a} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
                  <input type="checkbox" checked={form.audience.includes(a)} onChange={() => toggleAudience(a)} />
                  {AUDIENCE_LABEL[a]}
                </label>
              ))}
            </div>
          </Field>
          <Field label="App area (contextual help key, e.g. admin.orders)">
            <Input value={form.appArea} maxLength={60} onChange={(e) => set('appArea', e.target.value)} />
          </Field>
          <Field label="Tags (comma separated)">
            <Input value={form.tags} onChange={(e) => set('tags', e.target.value)} />
          </Field>
          <Field label="Related article slugs (comma separated)">
            <Input value={form.relatedSlugs} onChange={(e) => set('relatedSlugs', e.target.value)} />
          </Field>
          <Field label="Sort order">
            <Input type="number" min={0} value={form.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />
          </Field>
          {current && (
            <Field label="Change note (stored in version history)" className="md:col-span-2">
              <Input value={form.note} maxLength={200} onChange={(e) => set('note', e.target.value)} placeholder="e.g. clarified KOT reprint steps" />
            </Field>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Body (markdown: ## heading, - list, 1. steps, > note, **bold**, [link](help:slug))">
          <Textarea value={form.body} onChange={(e) => set('body', e.target.value)} rows={24} className="font-mono text-xs" />
        </Field>
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Live preview</div>
          <div className="min-h-[200px] rounded-xl border bg-card p-4">
            <h2 className="display mb-1 text-xl font-semibold">{form.title || 'Untitled'}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{form.summary}</p>
            <HelpMarkdownView blocks={blocks} basePath="/admin/help" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function VersionHistory({ articleId, version, onRestored }: { articleId: string; version: number; onRestored: (a: Article) => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [preview, setPreview] = useState<Version | null>(null);

  const load = useCallback(async () => {
    const j = await api<{ versions: Version[] }>(`/api/platform/help/articles/${articleId}/versions`, undefined, 'Could not load history');
    if (j) setVersions(j.versions);
  }, [articleId]);
  useEffect(() => {
    load();
  }, [load, version]);

  async function restore(v: Version) {
    if (!confirm(`Restore v${v.version}? It is saved as a new version; nothing is lost.`)) return;
    const j = await api<{ article: Article }>(`/api/platform/help/articles/${articleId}/versions/${v.id}/restore`, { method: 'POST' }, 'Could not restore');
    if (j) {
      toast.success(`Restored v${v.version} as v${j.article.version}`);
      setPreview(null);
      onRestored(j.article);
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-4 p-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Version history</h3>
          {versions === null ? (
            <Loader2 className="size-4 animate-spin" aria-label="Loading" />
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center gap-2 p-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      v{v.version} {v.version === version && <Badge variant="muted">current</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {v.note ?? 'edited'} · {v.authorName ?? 'unknown'} · {fmt(v.createdAt)}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setPreview(v)}>
                    View
                  </Button>
                  {v.version !== version && (
                    <Button size="sm" variant="outline" onClick={() => restore(v)}>
                      <RotateCcw aria-hidden /> Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          {preview ? (
            <div className="rounded-lg border p-3">
              <div className="mb-1 text-xs text-muted-foreground">Preview of v{preview.version}</div>
              <h4 className="font-semibold">{preview.title}</h4>
              <p className="mb-3 text-sm text-muted-foreground">{preview.summary}</p>
              <HelpMarkdownView blocks={parseHelpMarkdown(preview.body)} basePath="/admin/help" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select a version to preview it.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Categories ─────────────────────────────────────────────────────────────

const emptyCat = { slug: '', title: '', description: '', audience: 'RESTAURANT_ADMIN' as Audience, sortOrder: 0 };

function CategoriesPanel({ categories, reload }: { categories: Category[]; reload: () => Promise<void> }) {
  const [form, setForm] = useState<typeof emptyCat & { id?: string }>(emptyCat);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = JSON.stringify({ slug: form.slug.trim(), title: form.title, description: form.description || null, audience: form.audience, sortOrder: Number(form.sortOrder) || 0 });
    const j = form.id
      ? await api(`/api/platform/help/categories/${form.id}`, { method: 'PATCH', body }, 'Could not save category')
      : await api('/api/platform/help/categories', { method: 'POST', body }, 'Could not create category');
    setBusy(false);
    if (j) {
      toast.success(form.id ? 'Category saved' : 'Category created');
      setForm(emptyCat);
      reload();
    }
  }

  async function remove(c: Category) {
    if (!confirm(`Delete category "${c.title}"? Its ${c.articleCount ?? 0} article(s) become uncategorised.`)) return;
    if (await api(`/api/platform/help/categories/${c.id}`, { method: 'DELETE' }, 'Could not delete category')) {
      toast.success('Category deleted');
      reload();
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Category</th>
              <th className="p-3">Audience</th>
              <th className="p-3 text-right">Articles</th>
              <th className="p-3 text-right">Order</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {categories.map((c) => (
              <tr key={c.id}>
                <td className="p-3">
                  <div className="font-medium">{c.title}</div>
                  <div className="text-xs text-muted-foreground">{c.slug}</div>
                </td>
                <td className="p-3 text-muted-foreground">{AUDIENCE_LABEL[c.audience]}</td>
                <td className="p-3 text-right tabular-nums">{c.articleCount ?? 0}</td>
                <td className="p-3 text-right tabular-nums">{c.sortOrder}</td>
                <td className="p-3">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setForm({ ...c, description: c.description ?? '' })}>
                      <Pencil aria-hidden />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => remove(c)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {categories.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  No categories yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Card>
        <CardContent className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <h3 className="text-sm font-semibold">{form.id ? 'Edit category' : 'New category'}</h3>
            <Field label="Title">
              <Input required value={form.title} maxLength={100} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Slug">
              <Input required value={form.slug} maxLength={80} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
            </Field>
            <Field label="Description">
              <Input value={form.description} maxLength={300} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Audience">
              <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as Audience })} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                {AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {AUDIENCE_LABEL[a]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sort order">
              <Input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {form.id ? 'Save' : 'Create'}
              </Button>
              {form.id && (
                <Button type="button" variant="ghost" onClick={() => setForm(emptyCat)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Analytics ──────────────────────────────────────────────────────────────

interface Analytics {
  totals: { articles: number; published: number; views: number; feedback: number; helpfulPct: number | null; searches30d: number; zeroResult30d: number };
  articles: { id: string; slug: string; language: string; title: string; status: string; views: number; yes: number; no: number; helpfulPct: number | null }[];
  topSearches: { query: string; count: number; avgResults: number }[];
  zeroResultSearches: { query: string; count: number; lastAt: string }[];
  recentComments: { slug: string; title: string; helpful: boolean; comment: string; createdAt: string }[];
}

function AnalyticsPanel() {
  const [data, setData] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  useEffect(() => {
    setData(null);
    api<Analytics>(`/api/platform/help/analytics?days=${days}`, undefined, 'Could not load analytics').then((j) => j && setData(j));
  }, [days]);

  if (!data) return <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />;
  const t = data.totals;
  const tiles: [string, string][] = [
    ['Published articles', `${t.published} / ${t.articles}`],
    ['Total views', String(t.views)],
    ['Helpful', t.helpfulPct === null ? '—' : `${t.helpfulPct}% of ${t.feedback}`],
    [`Searches (${days}d)`, String(t.searches30d)],
    [`Zero-result searches (${days}d)`, String(t.zeroResult30d)],
  ];
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Search window</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Window">
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map(([k, v]) => (
          <Card key={k}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Top searches with zero results (content gaps)</h3>
          <SimpleTable
            empty="No zero-result searches in this window."
            head={['Query', 'Times', 'Last searched']}
            rows={data.zeroResultSearches.map((z) => [z.query, String(z.count), fmt(z.lastAt)])}
          />
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Top searches</h3>
          <SimpleTable
            empty="No searches in this window."
            head={['Query', 'Times', 'Avg results']}
            rows={data.topSearches.map((s) => [s.query, String(s.count), String(s.avgResults)])}
          />
        </section>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Articles by views</h3>
        <SimpleTable
          empty="No articles yet."
          head={['Article', 'Status', 'Views', 'Helpful', 'Not helpful', 'Helpful %']}
          rows={data.articles.map((a) => [`${a.title} (${a.language})`, a.status === 'PUBLISHED' ? 'Published' : 'Draft', String(a.views), String(a.yes), String(a.no), a.helpfulPct === null ? '—' : `${a.helpfulPct}%`])}
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Recent feedback comments</h3>
        <SimpleTable
          empty="No comments yet."
          head={['Article', 'Vote', 'Comment', 'When']}
          rows={data.recentComments.map((c) => [c.title, c.helpful ? 'Helpful' : 'Not helpful', c.comment, fmt(c.createdAt)])}
        />
      </section>
    </div>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (!rows.length) return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="p-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="p-3 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
