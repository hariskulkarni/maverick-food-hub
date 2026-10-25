'use client';
import { cn } from '@/lib/utils';

/**
 * "Continue with Google" following Google's sign-in branding: the standard
 * four-colour G on a white (light) / #131314 (dark) surface with the neutral
 * outline and text colours Google specifies.
 */
export function GoogleButton({ onClick, disabled, className }: { onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-12 w-full items-center justify-center gap-3 rounded-xl border px-4 text-[15px] font-semibold',
        'border-[#747775] bg-white text-[#1F1F1F] hover:bg-[#F8F9FA]',
        'dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#1f1f20]',
        'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25',
        'disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer',
        className,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 18 18" className="size-[18px] shrink-0">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.92v2.32A9 9 0 0 0 9 18Z" />
        <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.96H.92A9 9 0 0 0 0 9c0 1.45.35 2.83.92 4.04l3.05-2.32Z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .92 4.96l3.05 2.32C4.68 5.16 6.66 3.58 9 3.58Z" />
      </svg>
      Continue with Google
    </button>
  );
}
