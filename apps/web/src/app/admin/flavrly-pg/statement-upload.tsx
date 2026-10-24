'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Upload } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

type DateFormat = 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'YYYY-MM-DD' | 'DD-MMM-YYYY' | 'DD MMM YYYY';
const FORMATS: DateFormat[] = ['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY', 'DD MMM YYYY'];
const MAX_BYTES = 2_000_000;
const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm';

interface ImportRow {
  id: string; fileName: string; rowCount: number; insertedCount: number; duplicateCount: number; rejectedCount: number; status: string; createdAt: string;
}
interface Result {
  duplicateFile: boolean; insertedCount: number; duplicateCount: number; conflictCount: number; rejectedCount: number;
  rejected: { line: number; reason: string }[];
}
type Field = 'date' | 'valueDate' | 'narration' | 'reference' | 'credit' | 'debit';
const FIELDS: { key: Field; label: string; required: boolean; guess: RegExp }[] = [
  { key: 'date', label: 'Transaction date', required: true, guess: /^(txn |tran |transaction )?date$|^date$/i },
  { key: 'valueDate', label: 'Value date', required: false, guess: /value/i },
  { key: 'reference', label: 'Reference / UTR', required: true, guess: /utr|ref|chq/i },
  { key: 'credit', label: 'Credit amount', required: true, guess: /credit|deposit|\bcr\b/i },
  { key: 'debit', label: 'Debit amount', required: false, guess: /debit|withdraw|\bdr\b/i },
  { key: 'narration', label: 'Narration', required: false, guess: /narration|description|particulars|remarks|details/i },
];

/** Minimal quoted-CSV line splitter, used only to offer header names for the mapping UI. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** The header row: among the first 40 lines, the one with the most non-empty cells mentioning a date. */
function detectHeader(text: string): string[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).slice(0, 40).map(splitLine);
  const scored = lines
    .filter((c) => c.some((x) => /date/i.test(x)))
    .sort((a, b) => b.filter(Boolean).length - a.filter(Boolean).length);
  return (scored[0] ?? []).filter(Boolean);
}

export function StatementUpload({ accounts, imports }: { accounts: { id: string; label: string }[]; imports: ImportRow[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Partial<Record<Field, string>>>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>('DD/MM/YYYY');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onFile(f: File | undefined) {
    setErr(null);
    setResult(null);
    if (!f) return;
    if (f.size > MAX_BYTES) { setErr('File is larger than 2 MB. Export a shorter date range.'); return; }
    const content = await f.text();
    const h = detectHeader(content);
    if (h.length === 0) { setErr('Could not find a header row with a date column. Is this a CSV statement?'); return; }
    setFile({ name: f.name, content });
    setHeaders(h);
    const guess: Partial<Record<Field, string>> = {};
    for (const fd of FIELDS) {
      const hit = h.find((x) => fd.guess.test(x) && !Object.values(guess).includes(x));
      if (hit) guess[fd.key] = hit;
    }
    setMap(guess);
  }

  async function submit() {
    if (!file) return;
    const missing = FIELDS.filter((f) => f.required && !map[f.key]).map((f) => f.label);
    if (missing.length) { setErr(`Map these columns: ${missing.join(', ')}`); return; }
    setBusy(true);
    setErr(null);
    try {
      const mapping = { ...Object.fromEntries(Object.entries(map).filter(([, v]) => v)), dateFormat };
      const res = await fetch('/api/admin/pg/statements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivingAccountId: accountId, fileName: file.name, content: file.content, mapping }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Upload failed.'); return; }
      setResult(data as Result);
      toast.success(data.duplicateFile ? 'This file was already imported.' : `Imported ${data.insertedCount} new rows.`);
      router.refresh();
    } catch { setErr('Network error.'); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Upload className="size-4" /> Upload bank statement (CSV)</h2>
        <p className="text-xs text-muted-foreground">
          Export your account statement as CSV from net banking. Credits are matched to payments by UTR and exact amount. Re-uploading
          the same file or overlapping dates is safe: duplicates are skipped.
        </p>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No receiving account yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="st-acc">Receiving account</Label>
              <select id="st-acc" className={selectCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="st-file">CSV file</Label>
              <input id="st-file" type="file" accept=".csv,text/csv" className="block w-full text-sm" onChange={(e) => onFile(e.target.files?.[0])} />
            </div>
            {headers.length > 0 && (
              <>
                {FIELDS.map((fd) => (
                  <div key={fd.key} className="space-y-1">
                    <Label htmlFor={`map-${fd.key}`}>{fd.label}{fd.required ? '' : ' (optional)'}</Label>
                    <select id={`map-${fd.key}`} className={selectCls} value={map[fd.key] ?? ''} onChange={(e) => setMap({ ...map, [fd.key]: e.target.value || undefined })}>
                      <option value="">{fd.required ? 'Choose column…' : 'Not in file'}</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
                <div className="space-y-1">
                  <Label htmlFor="map-fmt">Date format</Label>
                  <select id="map-fmt" className={selectCls} value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                    {FORMATS.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </div>
              </>
            )}
            {err && <p role="alert" className="sm:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{err}</p>}
            <div className="sm:col-span-2">
              <Button disabled={busy || !file} onClick={submit}>{busy ? <Loader2 className="size-4 animate-spin" /> : 'Import statement'}</Button>
            </div>
          </div>
        )}
        {result && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
            {result.duplicateFile ? (
              <p>This exact file was imported before. Nothing new was added.</p>
            ) : (
              <p>
                Inserted <b>{result.insertedCount}</b> · duplicates skipped <b>{result.duplicateCount}</b> · conflicting duplicates{' '}
                <b>{result.conflictCount}</b> · rejected <b>{result.rejectedCount}</b>
              </p>
            )}
            {result.rejected.length > 0 && (
              <ul className="max-h-40 overflow-auto text-xs text-muted-foreground">
                {result.rejected.map((r) => <li key={`${r.line}-${r.reason}`}>Line {r.line}: {r.reason}</li>)}
              </ul>
            )}
          </div>
        )}
        {imports.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Recent imports</h3>
            <ul className="divide-y divide-border text-xs">
              {imports.map((i) => (
                <li key={i.id} className="py-1.5 flex flex-wrap justify-between gap-2">
                  <span className="break-all">{i.fileName}</span>
                  <span className="text-muted-foreground">
                    {new Date(i.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {i.insertedCount} new · {i.duplicateCount} dup · {i.rejectedCount} rejected · {i.status.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
