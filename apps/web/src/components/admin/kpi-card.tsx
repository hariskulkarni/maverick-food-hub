import { Card, CardContent } from '@/components/ui/card';
import { ArrowUpRight, ArrowDownRight, ArrowRight } from 'lucide-react';
import { Sparkline } from './sparkline';

type Trend = 'up' | 'down' | 'flat';

export function KpiCard({
  title, value, icon: Icon, trend, deltaPct, sparkline, accentColor, href
}: {
  title: string;
  value: string;
  icon?: any;
  trend?: Trend;
  deltaPct?: number;
  sparkline?: number[];
  accentColor?: 'primary' | 'success' | 'warning' | 'destructive';
  href?: string;
}) {
  const accent = accentColor ?? 'primary';
  const trendCls = trend === 'up' ? 'text-success' : trend === 'down' ? 'text-destructive' : 'text-muted-foreground';
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : ArrowRight;
  const accentBg = { primary: 'bg-primary/10 text-primary', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', destructive: 'bg-destructive/10 text-destructive' }[accent];
  const accentStroke = { primary: 'hsl(var(--primary))', success: 'hsl(var(--success))', warning: 'hsl(var(--warning))', destructive: 'hsl(var(--destructive))' }[accent];
  const inner = (
    <CardContent className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{title}</div>
          <div className="display text-2xl font-bold mt-1 leading-none">{value}</div>
          {(trend && deltaPct != null) && (
            <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${trendCls}`}>
              <TrendIcon className="size-3.5" />
              {Math.abs(deltaPct).toFixed(1)}% <span className="opacity-60 font-normal">vs last week</span>
            </div>
          )}
        </div>
        {Icon && <div className={`grid size-10 place-items-center rounded-lg shrink-0 ${accentBg}`}><Icon className="size-5" /></div>}
      </div>
      {sparkline && sparkline.length > 1 && (
        <div className="mt-3 -mb-1 -mx-1">
          <Sparkline data={sparkline} width={220} height={36} stroke={accentStroke} className="w-full h-9" />
        </div>
      )}
    </CardContent>
  );
  return href ? (
    <a href={href} className="block"><Card className="card-lift hover:border-primary/40 transition-colors">{inner}</Card></a>
  ) : (
    <Card>{inner}</Card>
  );
}
