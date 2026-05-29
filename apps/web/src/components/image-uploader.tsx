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
  /** Recommended image dimensions, e.g. "2600×1300 (2:1)". Surfaced prominently
   *  inside the empty drop zone AND under the box once uploaded, so editors
   *  always see the target size before they pick a file. */
  recommended?: string;
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
  recommended,
  className = ''
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  // Tracks whether the <img> tag failed to load its src. We surface a clear
  // "image failed to load" message instead of letting the browser show its
  // default broken-image glyph with no explanation.
  const [imgLoadFailed, setImgLoadFailed] = useState(false);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  // Reset the "image failed" indicator whenever the URL we'd render changes
  // (new value from parent, new local blob, or cleared) — otherwise a stale
  // failure flag from a previous URL bleeds into the next attempt.
  useEffect(() => {
    setImgLoadFailed(false);
  }, [value, localPreview]);

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
      const err = e as UploadError;
      // Auth-expired flow: the cookie went stale while the editor was open.
      // Surface a clear message AND prompt re-login so the user doesn't sit
      // there clicking Upload and getting silent failures.
      if (err.code === 'auth/unauthenticated') {
        setError('Your session has expired. Please sign in again to continue.');
        toast.error('Session expired', {
          description: 'Sign in again to keep editing.',
          action: {
            label: 'Sign in',
            onClick: () => {
              const next = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
              window.location.href = `/login?next=${encodeURIComponent(next)}&mode=admin`;
            },
          },
        });
        return;
      }
      if (err.code === 'auth/forbidden') {
        setError(err.message || "You don't have permission to upload here.");
        toast.error('Permission denied', { description: err.message });
        return;
      }
      const msg = err.message || 'Upload failed.';
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
          imgLoadFailed ? (
            // The <img> tried to load and failed (file moved, server 404, the
            // demo-gate middleware redirected an asset request, etc.). Show a
            // clear message instead of the silent broken-icon glyph so the
            // editor knows what to do (re-upload).
            <div className="absolute inset-0 grid place-items-center bg-destructive/5 p-3 text-destructive">
              <div className="text-center">
                <AlertCircle className="size-5 mx-auto" />
                <div className="mt-1 text-[11px] font-medium">Image failed to load</div>
                <div className="mt-0.5 text-[10px] text-destructive/80 break-all line-clamp-2">{value || displayUrl}</div>
                <div className="mt-1.5 inline-flex gap-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                    className="rounded-full bg-card/95 px-2 py-0.5 text-[10px] font-medium text-foreground shadow"
                  >
                    Re-upload
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); clear(); }}
                    className="rounded-full bg-card/95 px-2 py-0.5 text-[10px] font-medium text-foreground shadow"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                onError={() => setImgLoadFailed(true)}
              />
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
          )
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground p-4">
            <div className="text-center">
              <div className="inline-grid size-10 place-items-center rounded-full bg-card mb-2 shadow-sm">
                <ImageIcon className="size-5 text-muted-foreground" />
              </div>
              <div className="text-sm font-medium">Drop an image or click to upload</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">JPG, PNG, WebP, GIF, AVIF · max 8 MB</div>
              {recommended && (
                <div className="mt-1.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  Recommended: {recommended}
                </div>
              )}
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
      {/* Recommended size stays visible even after upload, so editors can
          double-check at a glance whether the image they picked fits the slot. */}
      {!error && recommended && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Recommended:</span> {recommended}
        </p>
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

/**
 * Server returns `{ error, code }` JSON for every non-2xx so the client can
 * react to specific failure modes (re-login on auth/unauthenticated, surface
 * the right inline message on auth/forbidden, etc.). When the body isn't
 * parseable JSON (truly catastrophic 500 or proxy intercept), we fall back to
 * the raw text + a generic code.
 */
type UploadErrorCode =
  | 'auth/unauthenticated'
  | 'auth/forbidden'
  | 'upload/bad_body'
  | 'upload/missing_file'
  | 'upload/empty_file'
  | 'upload/too_large'
  | 'upload/bad_type'
  | 'upload/storage_error'
  | 'upload/network'
  | 'upload/unknown';

class UploadError extends Error {
  code: UploadErrorCode;
  status: number;
  constructor(message: string, code: UploadErrorCode, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** XHR upload so we can wire `progress` events — fetch() doesn't expose them. */
function uploadWithProgress(url: string, file: File, folder: string, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folder', folder);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    // Same-origin XHR sends cookies by default, but being explicit makes the
    // intent obvious AND handles the edge case where a future deployment puts
    // the upload endpoint on a sibling subdomain.
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data?.url) return resolve(data.url);
          reject(new UploadError('Server did not return an image URL.', 'upload/unknown', xhr.status));
        } catch {
          reject(new UploadError('The server response was not valid JSON.', 'upload/unknown', xhr.status));
        }
        return;
      }
      // Try to parse the structured `{ error, code }` body the API now sends.
      let parsed: { error?: string; code?: string } = {};
      try { parsed = JSON.parse(xhr.responseText) ?? {}; } catch { /* fall through */ }
      const message = parsed.error || xhr.responseText || `HTTP ${xhr.status}`;
      const code = (parsed.code as UploadErrorCode) || 'upload/unknown';
      reject(new UploadError(message, code, xhr.status));
    };
    xhr.onerror = () => reject(new UploadError('Network error — please check your connection.', 'upload/network', 0));
    xhr.ontimeout = () => reject(new UploadError('Upload timed out. Try again.', 'upload/network', 0));
    xhr.send(fd);
  });
}
