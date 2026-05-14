'use client';
/**
 * ImageUploader — drag-and-drop image upload with preview.
 *
 * - Click or drop a file
 * - Shows an instant local preview
 * - Uploads to /api/admin/upload (or a custom endpoint via `uploadUrl`)
 * - Calls onUploaded(url) when complete; also stores the URL in state
 *
 * Accepts an existing URL via `value`, so it works as a controlled input.
 */
import { useEffect, useRef, useState } from 'react';
import { Upload, X, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  value?: string | null;
  onChange: (url: string | null) => void;
  folder?: string;
  uploadUrl?: string;
  aspect?: 'square' | 'video' | 'wide';
  label?: string;
  hint?: string;
  className?: string;
}

const ASPECT_CLS: Record<NonNullable<Props['aspect']>, string> = {
  square: 'aspect-square',
  video:  'aspect-video',
  wide:   'aspect-[3/1]'
};

export function ImageUploader({
  value,
  onChange,
  folder = 'uploads',
  uploadUrl = '/api/admin/upload',
  aspect = 'video',
  label,
  hint,
  className = ''
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Only image files are supported.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('File too large — max 8 MB.');
      return;
    }
    // Instant preview
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);

    setBusy(true);
    setProgress(0);
    try {
      const url = await uploadWithProgress(uploadUrl, file, folder, setProgress);
      onChange(url);
      toast.success('Image uploaded');
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
    onChange(null);
    setError(null);
  }

  const displayUrl = localPreview || value;

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && <div className="text-xs font-medium text-muted-foreground">{label}</div>}
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        className={`group relative overflow-hidden rounded-xl border-2 border-dashed cursor-pointer transition-all ${ASPECT_CLS[aspect]} ${
          dragOver ? 'border-primary bg-primary/5'
          : displayUrl ? 'border-transparent'
          : 'border-border bg-muted/30 hover:border-primary hover:bg-primary/5'
        }`}
      >
        {displayUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={displayUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                className="rounded-full bg-card/95 px-2.5 py-1 text-xs font-medium shadow hover:bg-card"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); clear(); }}
                className="rounded-full bg-card/95 p-1.5 shadow hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove image"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground p-4">
            <div className="text-center">
              <div className="inline-grid size-10 place-items-center rounded-full bg-card mb-2 shadow-sm">
                <ImageIcon className="size-5 text-muted-foreground" />
              </div>
              <div className="text-sm font-medium">Drop an image or click to upload</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">JPG, PNG, WebP, GIF, AVIF · max 8 MB</div>
            </div>
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 bg-card/80 backdrop-blur grid place-items-center">
            <div className="text-center">
              <Loader2 className="size-6 mx-auto text-primary animate-spin" />
              <div className="mt-2 text-xs font-medium">{progress > 0 ? `Uploading ${progress}%` : 'Preparing…'}</div>
              <div className="mt-2 h-1 w-32 rounded-full bg-muted overflow-hidden mx-auto">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5" /> {error}
        </div>
      )}
      {!error && hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          if (e.target) e.target.value = '';
        }}
      />
    </div>
  );
}

/** XHR upload so we can wire `progress` events — fetch() doesn't expose them. */
function uploadWithProgress(url: string, file: File, folder: string, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folder', folder);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data?.url) return resolve(data.url);
          reject(new Error('No url in response'));
        } catch {
          reject(new Error('Bad response'));
        }
      } else {
        reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(fd);
  });
}
