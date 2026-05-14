'use client';
import type { LucideIcon } from 'lucide-react';

/**
 * Pressable role-picker tile used in the central /login page.
 *
 * Visually: rounded card with an icon-chip + label + tagline. Active state
 * shows a saffron border with the `ring-saffron` glow and tints the icon chip
 * with the primary colour. Hover lifts the border colour and warms the icon
 * chip so the press affordance is obvious before the click.
 *
 * Accessibility: rendered as `<button type="button">` with `aria-pressed` so
 * screen readers announce the toggle state of the picker correctly.
 */
export function RoleTile({
  Icon,
  label,
  tagline,
  active,
  onClick
}: {
  Icon: LucideIcon;
  label: string;
  tagline: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'group reveal text-left rounded-2xl border bg-card p-4 transition-all tap-press',
        active
          ? 'border-primary bg-primary/5 ring-saffron'
          : 'border-border hover:border-primary/40 hover:shadow-sm hover:-translate-y-0.5'
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            'flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors',
            active
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
          ].join(' ')}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="font-semibold leading-tight">{label}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{tagline}</div>
        </div>
      </div>
    </button>
  );
}
