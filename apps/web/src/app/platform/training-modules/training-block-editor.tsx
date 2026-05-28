'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ImageUploader } from '@/components/image-uploader';
import {
  Plus, Trash2, ArrowUp, ArrowDown, GripVertical,
  Heading, AlignLeft, Image as ImageIcon, Lightbulb, CheckSquare, ListTree, Minus, HelpCircle,
} from 'lucide-react';
import type { ContentBlock, ContentBlockType, CalloutTone } from '@/server/training-cms';

/**
 * Block editor for training-module lessons. Drag-drop is intentionally omitted
 * — the up/down + delete controls are adequate for the volume of blocks we
 * expect (≤30) and keep this a vanilla component with no extra deps.
 */

const TYPE_META: Record<ContentBlockType, { icon: any; label: string }> = {
  heading:    { icon: Heading,    label: 'Heading' },
  paragraph:  { icon: AlignLeft,  label: 'Paragraph' },
  image:      { icon: ImageIcon,  label: 'Image' },
  callout:    { icon: Lightbulb,  label: 'Callout' },
  checklist:  { icon: CheckSquare, label: 'Checklist' },
  keyPoints:  { icon: ListTree,   label: 'Key points' },
  divider:    { icon: Minus,      label: 'Divider' },
  quiz:       { icon: HelpCircle, label: 'Quiz' },
};

let _seq = 0;
function newId(type: ContentBlockType) {
  return `b_${Date.now().toString(36)}_${(_seq++).toString(36)}`;
}

function blankBlock(type: ContentBlockType): ContentBlock {
  const id = newId(type);
  switch (type) {
    case 'heading':   return { id, type, text: '' };
    case 'paragraph': return { id, type, text: '' };
    case 'image':     return { id, type, src: '', alt: '', caption: '' };
    case 'callout':   return { id, type, tone: 'tip', title: '', body: '' };
    case 'checklist': return { id, type, title: '', items: [''] };
    case 'keyPoints': return { id, type, title: '', points: [''] };
    case 'divider':   return { id, type };
    case 'quiz':      return { id, type, question: '', options: ['', ''], correct: 0, explanation: '' };
  }
}

export function TrainingBlockEditor({
  blocks, onChange,
}: {
  blocks: ContentBlock[];
  onChange: (next: ContentBlock[]) => void;
}) {
  function update<T extends ContentBlock>(i: number, patch: Partial<T>) {
    onChange(blocks.map((b, idx) => (idx === i ? ({ ...b, ...patch } as ContentBlock) : b)));
  }
  function add(type: ContentBlockType) {
    onChange([...blocks, blankBlock(type)]);
  }
  function remove(i: number) {
    onChange(blocks.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {blocks.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No blocks yet. Add your first block below.
        </div>
      ) : (
        blocks.map((b, i) => (
          <BlockCard
            key={b.id}
            block={b}
            index={i}
            total={blocks.length}
            onUpdate={(patch) => update(i, patch)}
            onMove={(dir) => move(i, dir)}
            onRemove={() => remove(i)}
          />
        ))
      )}

      <AddBlockBar onAdd={add} />
    </div>
  );
}

function BlockCard({
  block, index, total, onUpdate, onMove, onRemove,
}: {
  block: ContentBlock;
  index: number;
  total: number;
  onUpdate: (patch: any) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const meta = TYPE_META[block.type];
  const Icon = meta.icon;
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <GripVertical className="size-3.5 opacity-50" />
        <Icon className="size-3.5 text-primary" />
        <span className="font-semibold">{index + 1}. {meta.label}</span>
        <span className="ml-auto flex items-center gap-1">
          <IconBtn disabled={index === 0} onClick={() => onMove(-1)} label="Move up"><ArrowUp className="size-3.5" /></IconBtn>
          <IconBtn disabled={index === total - 1} onClick={() => onMove(1)} label="Move down"><ArrowDown className="size-3.5" /></IconBtn>
          <IconBtn destructive onClick={onRemove} label="Remove"><Trash2 className="size-3.5" /></IconBtn>
        </span>
      </div>
      <div className="p-3">
        <BlockBody block={block} onUpdate={onUpdate} />
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, disabled, label, destructive }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label: string; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid size-7 place-items-center rounded border disabled:opacity-30 ${destructive ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-accent'}`}
    >
      {children}
    </button>
  );
}

function BlockBody({ block, onUpdate }: { block: ContentBlock; onUpdate: (patch: any) => void }) {
  switch (block.type) {
    case 'heading':
      return <Input value={block.text} onChange={(e) => onUpdate({ text: e.target.value })} placeholder="Section heading" className="h-10 font-semibold" />;
    case 'paragraph':
      return <Textarea value={block.text} onChange={(e) => onUpdate({ text: e.target.value })} placeholder="Paragraph body" className="min-h-[100px]" />;
    case 'image':
      return (
        <div className="space-y-2">
          <ImageUploader
            value={block.src}
            onChange={(url) => onUpdate({ src: url || '' })}
            folder="training"
            aspect="video"
            recommended="1200×675 px (16:9) · landscape photo or illustration"
          />
          <Input value={block.alt ?? ''} onChange={(e) => onUpdate({ alt: e.target.value })} placeholder="Alt text (for accessibility + SEO)" className="h-9" />
          <Input value={block.caption ?? ''} onChange={(e) => onUpdate({ caption: e.target.value })} placeholder="Caption (optional)" className="h-9" />
        </div>
      );
    case 'callout': {
      const tones: CalloutTone[] = ['tip', 'warning', 'success', 'danger', 'info'];
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {tones.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onUpdate({ tone: t })}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${block.tone === t ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <Input value={block.title ?? ''} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Callout title (optional)" className="h-9" />
          <Textarea value={block.body} onChange={(e) => onUpdate({ body: e.target.value })} placeholder="Callout body" className="min-h-[80px]" />
        </div>
      );
    }
    case 'checklist':
    case 'keyPoints': {
      const items = block.type === 'checklist' ? block.items : block.points;
      const setItems = (next: string[]) => onUpdate(block.type === 'checklist' ? { items: next } : { points: next });
      return (
        <div className="space-y-2">
          <Input value={block.title ?? ''} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Title (optional)" className="h-9" />
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={it} onChange={(e) => setItems(items.map((x, idx) => idx === i ? e.target.value : x))} placeholder={`Item ${i + 1}`} className="h-9 flex-1" />
              <IconBtn destructive onClick={() => setItems(items.filter((_, idx) => idx !== i))} label="Remove"><Trash2 className="size-3.5" /></IconBtn>
            </div>
          ))}
          <button type="button" onClick={() => setItems([...items, ''])} className="inline-flex items-center gap-1 text-xs text-primary"><Plus className="size-3.5" /> Add item</button>
        </div>
      );
    }
    case 'divider':
      return <div className="text-xs text-muted-foreground italic">A visual horizontal rule between sections.</div>;
    case 'quiz':
      return (
        <div className="space-y-2">
          <Textarea value={block.question} onChange={(e) => onUpdate({ question: e.target.value })} placeholder="Quiz question" className="min-h-[60px]" />
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Options (click ◯ to mark correct)</Label>
          {block.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onUpdate({ correct: i })}
                aria-label={`Mark option ${i + 1} as correct`}
                className={`grid size-7 place-items-center rounded-full border-2 shrink-0 ${block.correct === i ? 'border-success bg-success text-white' : 'border-border hover:border-primary'}`}
              >
                {block.correct === i ? '✓' : String.fromCharCode(65 + i)}
              </button>
              <Input value={opt} onChange={(e) => onUpdate({ options: block.options.map((x, idx) => idx === i ? e.target.value : x) })} placeholder={`Option ${i + 1}`} className="h-9 flex-1" />
              <IconBtn destructive onClick={() => onUpdate({ options: block.options.filter((_, idx) => idx !== i), correct: Math.max(0, block.correct - (block.correct === i ? 1 : 0)) })} label="Remove option"><Trash2 className="size-3.5" /></IconBtn>
            </div>
          ))}
          {block.options.length < 6 && (
            <button type="button" onClick={() => onUpdate({ options: [...block.options, ''] })} className="inline-flex items-center gap-1 text-xs text-primary"><Plus className="size-3.5" /> Add option</button>
          )}
          <Textarea value={block.explanation ?? ''} onChange={(e) => onUpdate({ explanation: e.target.value })} placeholder="Explanation shown after the rider answers (optional)" className="min-h-[60px]" />
        </div>
      );
  }
}

function AddBlockBar({ onAdd }: { onAdd: (type: ContentBlockType) => void }) {
  return (
    <div className="rounded-xl border-2 border-dashed bg-muted/20 p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">+ Add a block</div>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(TYPE_META) as ContentBlockType[]).map((t) => {
          const { icon: Icon, label } = TYPE_META[t];
          return (
            <Button key={t} type="button" size="sm" variant="outline" onClick={() => onAdd(t)}>
              <Icon className="size-3.5" /> {label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
