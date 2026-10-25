'use client';
/**
 * Renders one training lesson (markdown body + image / video / checklist).
 * Markdown is parsed to data (src/lib/training-markdown.ts) and mapped to
 * elements here — no HTML injection.
 */
import { useState } from 'react';
import { Check, ExternalLink, PlayCircle } from 'lucide-react';
import { parseMarkdown, type InlineSpan } from '@/lib/training-markdown';
import { videoSource } from '@/lib/training-video';
import { cn } from '@/lib/utils';

export interface LessonView {
  id: string;
  kind: 'TEXT' | 'IMAGE' | 'VIDEO' | 'CHECKLIST';
  title: string;
  body: string;
  mediaUrl: string | null;
  checklistItems: string[];
}

function Inline({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.t === 'bold' ? (
          <strong key={i} className="font-semibold text-foreground">{s.v}</strong>
        ) : s.t === 'italic' ? (
          <em key={i}>{s.v}</em>
        ) : s.t === 'link' ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            {s.v}
          </a>
        ) : (
          <span key={i}>{s.v}</span>
        ),
      )}
    </>
  );
}

export function TrainingMarkdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-foreground/90">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return b.level === 2 ? (
            <h3 key={i} className="pt-2 text-lg font-semibold text-foreground">{b.text}</h3>
          ) : (
            <h4 key={i} className="pt-1 text-base font-semibold text-foreground">{b.text}</h4>
          );
        }
        if (b.type === 'paragraph') return <p key={i}><Inline spans={b.spans} /></p>;
        if (b.type === 'image') {
          // eslint-disable-next-line @next/next/no-img-element
          return <img key={i} src={b.src} alt={b.alt} className="w-full rounded-lg border bg-muted object-cover" loading="lazy" />;
        }
        const ListTag = b.ordered ? 'ol' : 'ul';
        return (
          <ListTag key={i} className={cn('space-y-1.5 pl-5', b.ordered ? 'list-decimal' : 'list-disc')}>
            {b.items.map((it, j) => (
              <li key={j}><Inline spans={it} /></li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
}

function Video({ url, title }: { url: string; title: string }) {
  const v = videoSource(url);
  if (v.kind === 'embed') {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black">
        <iframe
          src={v.src}
          title={title}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          loading="lazy"
        />
      </div>
    );
  }
  if (v.kind === 'file') {
    return <video src={v.src} controls preload="metadata" className="w-full rounded-lg border bg-black" />;
  }
  if (v.kind === 'link') {
    return (
      <a href={v.src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium hover:bg-accent">
        <PlayCircle className="size-5 text-primary" /> Watch the video <ExternalLink className="size-3.5 text-muted-foreground" />
      </a>
    );
  }
  return <p className="text-sm text-muted-foreground">This video link is not valid.</p>;
}

export function LessonContent({ lesson }: { lesson: LessonView }) {
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  return (
    <div className="space-y-4">
      {lesson.kind === 'IMAGE' && lesson.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={lesson.mediaUrl} alt={lesson.title} className="w-full rounded-lg border bg-muted object-cover" />
      )}
      {lesson.kind === 'VIDEO' && lesson.mediaUrl && <Video url={lesson.mediaUrl} title={lesson.title} />}
      {lesson.body.trim() && <TrainingMarkdown source={lesson.body} />}
      {lesson.kind === 'CHECKLIST' && lesson.checklistItems.length > 0 && (
        <ul className="space-y-2 rounded-xl border bg-card p-4">
          {lesson.checklistItems.map((item, i) => {
            const on = ticked.has(i);
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() =>
                    setTicked((s) => {
                      const n = new Set(s);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })
                  }
                  className="flex w-full items-start gap-3 py-1 text-left text-sm"
                  aria-pressed={on}
                >
                  <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border', on ? 'border-success bg-success text-white' : 'border-border')}>
                    {on && <Check className="size-3.5" />}
                  </span>
                  <span className={on ? 'text-muted-foreground line-through' : ''}>{item}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
