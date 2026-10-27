/**
 * Prints the observability alerts that are currently FIRING (severity, rule key,
 * title, since). No secrets — alert titles/details are written by the alert
 * rules. Used by scripts/server-ops.sh status.
 *
 *   npx tsx scripts/obs-firing.ts
 */
import { prisma } from '../src/server/db';

async function main(): Promise<void> {
  const rows = await prisma.obsAlert.findMany({
    where: { state: 'FIRING' },
    orderBy: [{ severity: 'asc' }, { firstFiredAt: 'asc' }],
    select: { severity: true, ruleKey: true, title: true, detail: true, firstFiredAt: true, acknowledgedAt: true },
  });
  if (!rows.length) {
    console.log('  none');
    return;
  }
  for (const a of rows) {
    const ack = a.acknowledgedAt ? ' (acknowledged)' : '';
    console.log(`  ${a.severity.padEnd(8)} ${a.ruleKey}  since ${a.firstFiredAt.toISOString()}${ack}`);
    console.log(`           ${a.title}`);
    if (a.detail) console.log(`           ${a.detail}`);
  }
}

main()
  .catch((e) => {
    console.error('  query failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
