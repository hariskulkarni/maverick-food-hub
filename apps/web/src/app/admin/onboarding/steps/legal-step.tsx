'use client';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ImageUploader } from '@/components/image-uploader';
import { validateFssai, validateGstin, validatePan, validateGstinMatchesPan } from '@/lib/onboarding/validators';
import { StepFrame, Field, apiJson, useDebouncedSave } from '../parts';
import type { StepProps } from '../wizard-client';

interface BranchLegal { id: string; name: string; fssaiLicenseNumber: string; fssaiLicenseType: string; fssaiExpiresOn: string; fssaiLicenseImageUrl: string }
interface LegalForm { legalName: string; gstin: string; pan: string; branches: BranchLegal[] }

const LICENCE_TYPES = ['Registration', 'State', 'Central'];

export function LegalStep({ data, draft, saveDraft, complete, goTo }: StepProps) {
  const active = data.branches.filter((b) => b.isActive);
  const initial: LegalForm = {
    legalName: data.restaurant.legalName ?? '', gstin: data.restaurant.gstin ?? '', pan: data.restaurant.pan ?? '',
    branches: active.map((b) => ({
      id: b.id, name: b.name,
      fssaiLicenseNumber: b.fssaiLicenseNumber ?? '', fssaiLicenseType: b.fssaiLicenseType ?? '',
      fssaiExpiresOn: b.fssaiExpiresOn ? b.fssaiExpiresOn.slice(0, 10) : '', fssaiLicenseImageUrl: b.fssaiLicenseImageUrl ?? '',
    })),
  };
  const d = draft as Partial<LegalForm> | undefined;
  const [f, setF] = useState<LegalForm>({
    ...initial, ...(d ?? {}),
    // Only keep drafted branch rows that still exist.
    branches: initial.branches.map((b) => ({ ...b, ...(d?.branches?.find((x) => x.id === b.id) ?? {}) })),
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  useDebouncedSave(f, saveDraft);

  const errors = useMemo(() => ({
    gstin: validateGstin(f.gstin),
    pan: validatePan(f.pan) ?? validateGstinMatchesPan(f.gstin, f.pan),
    branches: Object.fromEntries(f.branches.map((b) => [b.id, {
      number: validateFssai(b.fssaiLicenseNumber),
      expiry: b.fssaiExpiresOn && new Date(b.fssaiExpiresOn).getTime() < Date.now() ? 'This date is in the past — the licence has expired. Enter the renewed licence.' : null,
    }])) as Record<string, { number: string | null; expiry: string | null }>,
  }), [f]);
  const hasErrors = !!errors.gstin || !!errors.pan || Object.values(errors.branches).some((e) => e.number || e.expiry);

  const patchBranch = (id: string, patch: Partial<BranchLegal>) =>
    setF((p) => ({ ...p, branches: p.branches.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));

  async function save() {
    setTouched(true);
    if (hasErrors) { toast.error('Fix the highlighted fields first.'); return; }
    setBusy(true);
    let ok = !!(await apiJson('/api/admin/onboarding/legal', 'PATCH', { legalName: f.legalName, gstin: f.gstin, pan: f.pan }, 'Could not save tax details'));
    for (const b of f.branches) {
      if (!ok) break;
      ok = !!(await apiJson(`/api/admin/settings/branch/${b.id}`, 'PATCH', {
        fssaiLicenseNumber: b.fssaiLicenseNumber.replace(/\s+/g, ''),
        fssaiLicenseType: b.fssaiLicenseType || null,
        fssaiExpiresOn: b.fssaiExpiresOn || null,
        fssaiLicenseImageUrl: b.fssaiLicenseImageUrl || null,
      }, `Could not save the FSSAI licence for ${b.name}`));
    }
    setBusy(false);
    if (ok) { toast.success('Compliance details saved'); await complete(); }
  }

  return (
    <StepFrame
      title="Legal & compliance"
      intro="Every kitchen selling food in India needs an FSSAI licence or registration, issued for the premises it cooks in. GST details are only needed if you are GST-registered."
      why="Food delivery platforms must show your FSSAI number to customers, and we check it before you go live. Your GSTIN and PAN print on your settlement reports so your accountant can reconcile payouts."
      example={<>FSSAI <b>10020042007183</b> (14 digits, starts with 1 for a licence or 2 for a registration) · GSTIN <b>27AAPFU0939F1ZV</b> (15 characters — the middle ten are your PAN) · PAN <b>AAPFU0939F</b>.</>}
    >
      {active.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-sm">
          FSSAI licences are issued per kitchen, so add your branch first.{' '}
          <button type="button" className="text-primary underline" onClick={() => goTo('branches')}>Go to Branch & hours</button>
        </div>
      ) : (
        <div className="space-y-4">
          {f.branches.map((b) => (
            <div key={b.id} className="rounded-xl border p-4 space-y-4">
              <div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-primary" /> FSSAI — {b.name}</div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="FSSAI number" required error={touched ? errors.branches[b.id]?.number : null} hint="14 digits, e.g. 10020042007183">
                  <Input inputMode="numeric" value={b.fssaiLicenseNumber} onChange={(e) => patchBranch(b.id, { fssaiLicenseNumber: e.target.value })} onBlur={() => setTouched(true)} placeholder="10020042007183" />
                </Field>
                <Field label="Licence type" hint="Registration: small kitchens; State / Central: larger turnovers.">
                  <select value={b.fssaiLicenseType} onChange={(e) => patchBranch(b.id, { fssaiLicenseType: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Select…</option>
                    {LICENCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Valid until" error={errors.branches[b.id]?.expiry} hint="We remind you before it expires.">
                  <Input type="date" value={b.fssaiExpiresOn} onChange={(e) => patchBranch(b.id, { fssaiExpiresOn: e.target.value })} />
                </Field>
              </div>
              <div className="max-w-sm">
                <ImageUploader value={b.fssaiLicenseImageUrl} onChange={(u) => patchBranch(b.id, { fssaiLicenseImageUrl: u ?? '' })} folder="food-licenses" aspect="video" label="Licence photo (optional)" recommended="A clear, straight photo of the certificate" />
              </div>
            </div>
          ))}

          <div className="rounded-xl border p-4 space-y-4">
            <div className="font-medium">Tax details <span className="text-xs font-normal text-muted-foreground">(optional)</span></div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Legal business name" hint="As on your GST/PAN, e.g. Spice Garden Foods LLP">
                <Input value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} placeholder="Spice Garden Foods LLP" />
              </Field>
              <Field label="GSTIN" error={f.gstin ? errors.gstin : null} hint="15 characters, e.g. 27AAPFU0939F1ZV">
                <Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} className="font-mono uppercase" maxLength={15} placeholder="27AAPFU0939F1ZV" />
              </Field>
              <Field label="PAN" error={f.pan ? errors.pan : null} hint="10 characters, e.g. AAPFU0939F">
                <Input value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} className="font-mono uppercase" maxLength={10} placeholder="AAPFU0939F" />
              </Field>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Save & continue</Button>
          </div>
        </div>
      )}
    </StepFrame>
  );
}
