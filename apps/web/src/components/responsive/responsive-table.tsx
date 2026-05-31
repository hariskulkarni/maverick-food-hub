import React from 'react';

/**
 * ResponsiveTable — renders as a real <table> on tablet/desktop (md+) and
 * as a stack of compact cards on phones (< md), where each card lists the
 * column header + the cell value vertically. One component every list view
 * uses, so the mobile/desktop UX stays consistent.
 *
 * Usage:
 *   <ResponsiveTable
 *     columns={[
 *       { key: 'name',   header: 'Name', primary: true },
 *       { key: 'status', header: 'Status' },
 *       { key: 'total',  header: 'Total', className: 'text-right tabular-nums' },
 *     ]}
 *     rows={orders.map((o) => ({
 *       id: o.id,
 *       href: `/admin/orders/${o.id}`,
 *       cells: {
 *         name:   o.code,
 *         status: <Badge>{o.status}</Badge>,
 *         total:  money(o.total),
 *       },
 *     }))}
 *   />
 *
 * Each row may have a `href` — clicking the row navigates. `primary` columns
 * are emphasised on mobile cards (the visual hook for each row).
 */

export interface RTColumn<K extends string = string> {
  key: K;
  header: React.ReactNode;
  /** Tailwind className for both <th> and <td>/card line. */
  className?: string;
  /** Emphasised on mobile card (larger, top-aligned). */
  primary?: boolean;
  /** Hide on mobile cards (e.g. very wide secondary columns). */
  hideOnMobile?: boolean;
  /** Hide on desktop table (rare — usually used to pack mobile-only info into the card). */
  hideOnDesktop?: boolean;
}

export interface RTRow<K extends string = string> {
  id: string;
  /** Optional — clicking the row navigates here. */
  href?: string;
  /** Optional click handler when the row isn't a link. */
  onClick?: () => void;
  cells: Partial<Record<K, React.ReactNode>>;
  /** Optional row-level className for both modes. */
  className?: string;
}

interface Props<K extends string> {
  columns: RTColumn<K>[];
  rows: RTRow<K>[];
  /** Rendered when rows is empty. */
  emptyState?: React.ReactNode;
  /** Tailwind className for the outer wrapper. */
  className?: string;
}

export function ResponsiveTable<K extends string>({ columns, rows, emptyState, className }: Props<K>) {
  if (rows.length === 0) {
    return (
      <div className={`rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground ${className ?? ''}`}>
        {emptyState ?? 'No items to show.'}
      </div>
    );
  }

  const desktopCols = columns.filter((c) => !c.hideOnDesktop);
  const mobileCols = columns.filter((c) => !c.hideOnMobile);

  return (
    <div className={className}>
      {/* DESKTOP: real <table> with horizontal scroll fallback for very wide content. */}
      <div className="hidden md:block overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {desktopCols.map((c) => (
                <th key={c.key} className={`px-3 py-2.5 font-semibold ${c.className ?? ''}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <DesktopRow key={row.id} row={row} columns={desktopCols} />
            ))}
          </tbody>
        </table>
      </div>

      {/* MOBILE: card stack. Each row is its own card with vertically-listed
          header→value pairs. The primary column floats to the top. */}
      <ul className="md:hidden space-y-2.5">
        {rows.map((row) => (
          <MobileCard key={row.id} row={row} columns={mobileCols} />
        ))}
      </ul>
    </div>
  );
}

function DesktopRow<K extends string>({ row, columns }: { row: RTRow<K>; columns: RTColumn<K>[] }) {
  const interactive = row.href || row.onClick;
  return (
    <tr
      onClick={row.onClick}
      className={`${interactive ? 'cursor-pointer hover:bg-accent/50' : ''} ${row.className ?? ''}`}
    >
      {columns.map((c) => (
        <td key={c.key} className={`px-3 py-2.5 align-middle ${c.className ?? ''}`}>
          {row.href ? <a href={row.href} className="block w-full">{row.cells[c.key] ?? <span className="text-muted-foreground">—</span>}</a>
                    : row.cells[c.key] ?? <span className="text-muted-foreground">—</span>}
        </td>
      ))}
    </tr>
  );
}

function MobileCard<K extends string>({ row, columns }: { row: RTRow<K>; columns: RTColumn<K>[] }) {
  const primaries = columns.filter((c) => c.primary);
  const secondaries = columns.filter((c) => !c.primary);
  const content = (
    <div className={`rounded-xl border bg-card p-3 space-y-2 ${row.className ?? ''}`}>
      {primaries.length > 0 && (
        <div className="space-y-0.5">
          {primaries.map((c) => (
            <div key={c.key} className={`font-semibold text-sm ${c.className ?? ''}`}>
              {row.cells[c.key] ?? <span className="text-muted-foreground">—</span>}
            </div>
          ))}
        </div>
      )}
      {secondaries.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {secondaries.map((c) => (
            <React.Fragment key={c.key}>
              <dt className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold py-0.5">
                {c.header}
              </dt>
              <dd className={`min-w-0 truncate ${c.className ?? ''}`}>
                {row.cells[c.key] ?? <span className="text-muted-foreground">—</span>}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
  if (row.href) return <li><a href={row.href} className="block min-h-[44px]">{content}</a></li>;
  if (row.onClick) return <li><button type="button" onClick={row.onClick} className="w-full text-left min-h-[44px]">{content}</button></li>;
  return <li>{content}</li>;
}
