import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROGRESS_STEPS, progressIndex, type OnboardingStep } from '@/lib/onboarding';

/**
 * Five-dot progress indicator with labels. The filled track grows with a
 * transform (no layout shift); the current dot is announced via aria-current.
 */
export function StepProgress({ step }: { step: OnboardingStep }) {
  const current = progressIndex(step);
  const total = PROGRESS_STEPS.length;
  return (
    <nav aria-label="Sign-up progress">
      <p className="sr-only">
        Step {current + 1} of {total}: {PROGRESS_STEPS[current]?.label}
      </p>
      <div className="relative">
        <div className="absolute left-6 right-6 top-4 h-1 -translate-y-1/2 rounded-full bg-border" aria-hidden="true" />
        <div
          aria-hidden="true"
          className="absolute left-6 right-6 top-4 h-1 origin-left rounded-full bg-primary transition-transform duration-500 ease-smooth"
          style={{ transform: `translateY(-50%) scaleX(${total > 1 ? current / (total - 1) : 0})` }}
        />
        <ol className="relative flex items-start justify-between">
          {PROGRESS_STEPS.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s.id} className="flex w-12 flex-col items-center gap-1.5" aria-current={active ? 'step' : undefined}>
                <span
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors duration-300',
                    done && 'border-primary bg-primary text-primary-foreground',
                    active && 'border-primary bg-background text-primary ring-4 ring-primary/15',
                    !done && !active && 'border-border bg-background text-muted-foreground',
                  )}
                >
                  {done ? <Check className="size-4" aria-hidden="true" /> : i + 1}
                </span>
                <span className={cn('text-[11px] font-semibold', active ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
