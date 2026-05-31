import React from 'react';

/**
 * FormGrid — drop-in replacement for ad-hoc `grid grid-cols-N` field rows in
 * settings forms / wizards / editors. Stacks 1-col on phones, scales up by
 * breakpoint. Removes the dozens of "grid-cols-3 of inputs" that overflow on
 * 360px viewports.
 *
 * Usage:
 *   <FormGrid cols={3} gap="md">
 *     <Field label="Foo">…</Field>
 *     <Field label="Bar">…</Field>
 *     <Field label="Baz">…</Field>
 *   </FormGrid>
 *
 * Behaviour:
 *   cols=2 → grid-cols-1 sm:grid-cols-2
 *   cols=3 → grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
 *   cols=4 → grid-cols-1 sm:grid-cols-2 lg:grid-cols-4
 */

type Cols = 2 | 3 | 4;
type Gap = 'sm' | 'md' | 'lg';

const COLS_CLASS: Record<Cols, string> = {
  2: 'grid grid-cols-1 sm:grid-cols-2',
  3: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};
const GAP_CLASS: Record<Gap, string> = {
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4 md:gap-5',
};

export function FormGrid({
  cols = 2,
  gap = 'md',
  className,
  children,
}: {
  cols?: Cols;
  gap?: Gap;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${COLS_CLASS[cols]} ${GAP_CLASS[gap]} ${className ?? ''}`}>
      {children}
    </div>
  );
}

/**
 * StatGrid — same responsive idea but for KPI/stat cards. Defaults to 4-up
 * because that's the most common dashboard shape; 1-col phone, 2-col small,
 * 4-col desktop.
 */
export function StatGrid({
  cols = 4,
  className,
  children,
}: {
  cols?: 2 | 3 | 4 | 5;
  className?: string;
  children: React.ReactNode;
}) {
  const map: Record<2 | 3 | 4 | 5, string> = {
    2: 'grid grid-cols-2',
    3: 'grid grid-cols-2 md:grid-cols-3',
    4: 'grid grid-cols-2 md:grid-cols-4',
    5: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
  };
  return (
    <div className={`${map[cols]} gap-3 md:gap-4 ${className ?? ''}`}>
      {children}
    </div>
  );
}
