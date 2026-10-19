'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BranchForm } from './branch-form';

type BranchData = React.ComponentProps<typeof BranchForm>['branch'];

export function BranchesAccordion({ branches }: { branches: BranchData[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (branches.length === 0) {
    return (
      <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
        No branches yet. Add one from the Branches page.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-3">
      {branches.map((b) => {
        const open = openId === b.id;
        const address = [b.line1, b.city].filter(Boolean).join(', ');
        return (
          <Card key={b.id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : b.id)}
              className="flex w-full items-center justify-between gap-3 rounded-lg p-4 text-left transition-colors hover:bg-accent sm:p-5"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{b.name}</div>
                <div className="truncate text-xs text-muted-foreground">{address}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge variant={b.isActive ? 'success' : 'muted'}>{b.isActive ? 'Open' : 'Closed'}</Badge>
                <ChevronDown className={`size-5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {open && (
              <CardContent className="border-t p-4 pt-6 sm:p-6">
                <BranchForm branch={b} />
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
