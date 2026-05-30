'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Upload, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { money } from '@/lib/utils';
import { reportApiError } from '@/lib/api-error';

type RowAction = 'create' | 'update' | 'error';

interface DiffRow {
  index: number;
  action: RowAction;
  category: string;
  name: string;
  price?: number;
  isVeg?: boolean;
  errors: string[];
}

interface MenuRow {
  category: string;
  name: string;
  description?: string;
  price?: number;
  isVeg?: boolean;
  spicyLevel?: number;
  prepTimeMin?: number;
  isAvailable?: boolean;
}

interface Summary {
  created: number;
  updated: number;
  errors: number;
}

const ACTION_BADGE: Record<RowAction, { label: string; variant: 'success' | 'default' | 'destructive' }> = {
  create: { label: 'New', variant: 'success' },
  update: { label: 'Update', variant: 'default' },
  error: { label: 'Error', variant: 'destructive' },
};

export function ImportExportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<MenuRow[] | null>(null);
  const [diff, setDiff] = useState<DiffRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const hasErrors = (summary?.errors ?? 0) > 0;

  function resetPreview() {
    setRows(null);
    setDiff(null);
    setSummary(null);
  }

  async function preview() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error('Choose a CSV or Excel file first');
      return;
    }
    setPreviewing(true);
    resetPreview();
    try {
      const body = new FormData();
      body.append('file', file);
      let r: Response;
      try {
        r = await fetch('/api/admin/menu/import', { method: 'POST', body });
      } catch (e) {
        toast.error('Preview failed', { description: 'Network problem — check your connection and retry.' });
        return;
      }
      if (!r.ok) {
        await reportApiError(r, 'Preview failed');
        return;
      }
      const j = (await r.json()) as { rows: MenuRow[]; diff: DiffRow[]; summary: Summary; notice?: string };
      setRows(j.rows);
      setDiff(j.diff);
      setSummary(j.summary);
      if (j.notice) toast.message(j.notice);
      else if (j.diff.length === 0) toast.message('No rows found in that file');
    } finally {
      setPreviewing(false);
    }
  }

  async function apply() {
    if (!rows || !diff) return;
    if (hasErrors) {
      toast.error('Fix the error rows before applying');
      return;
    }
    // Send only the rows the diff classified as create/update (skip errors).
    const okIndexes = new Set(diff.filter((d) => d.action !== 'error').map((d) => d.index));
    const toApply = rows.filter((_, i) => okIndexes.has(i + 1));
    setApplying(true);
    try {
      let r: Response;
      try {
        r = await fetch('/api/admin/menu/import/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: toApply }),
        });
      } catch (e) {
        toast.error('Apply failed', { description: 'Network problem — check your connection and retry.' });
        return;
      }
      if (!r.ok) {
        await reportApiError(r, 'Apply failed');
        return;
      }
      const s = (await r.json()) as { created: number; updated: number; skipped: number; categoriesCreated: number };
      toast.success(
        `Imported: ${s.created} new, ${s.updated} updated` +
          (s.categoriesCreated ? `, ${s.categoriesCreated} new categor${s.categoriesCreated === 1 ? 'y' : 'ies'}` : ''),
      );
      resetPreview();
      setFileName(null);
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-5 text-primary" />
          <h2 className="font-semibold">Bulk import &amp; export</h2>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/api/admin/menu/template" download>
              <Download className="size-4" /> Blank template
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/api/admin/menu/template?prefill=indian" download>
              <Download className="size-4" /> Indian catalog template
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/api/admin/menu/export" download>
              <Download className="size-4" /> Export current menu
            </a>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
          <Button size="sm" disabled={previewing || !fileName} onClick={preview}>
            <Upload className="size-4" /> {previewing ? 'Reading…' : 'Preview import'}
          </Button>
        </div>

        {summary && diff && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="success">{summary.created} new</Badge>
              <Badge variant="default">{summary.updated} updates</Badge>
              {summary.errors > 0 ? (
                <Badge variant="destructive">{summary.errors} error{summary.errors === 1 ? '' : 's'}</Badge>
              ) : (
                <Badge variant="muted">0 errors</Badge>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map((d) => {
                    const badge = ACTION_BADGE[d.action];
                    return (
                      <tr key={d.index} className="border-t">
                        <td className="px-3 py-2 text-muted-foreground">{d.index}</td>
                        <td className="px-3 py-2">
                          <Badge variant={badge.variant} className="text-[10px]">{badge.label}</Badge>
                        </td>
                        <td className="px-3 py-2">{d.category || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2">{d.name || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2">{d.price === undefined ? <span className="text-muted-foreground">—</span> : money(d.price)}</td>
                        <td className="px-3 py-2 text-xs text-destructive">{d.errors.join('; ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2">
              {hasErrors && (
                <span className="text-xs text-muted-foreground">Fix the error rows in your file and preview again.</span>
              )}
              <Button disabled={applying || hasErrors || (summary.created + summary.updated === 0)} onClick={apply}>
                {applying ? 'Applying…' : `Confirm & apply (${summary.created + summary.updated})`}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
