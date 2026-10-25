/**
 * One-off: move rider KYC files uploaded before the private-storage change
 * (fileUrl `/uploads/rider-kyc/...` under public/) into private storage and
 * repoint the rows (P1-14). Idempotent — rows already `private:` are skipped,
 * and the public copy is deleted only after the private write + row update.
 *
 *   cd apps/web && npx tsx scripts/migrate-kyc-private.ts          # dry run
 *   cd apps/web && npx tsx scripts/migrate-kyc-private.ts --apply  # do it
 *
 * Until it runs, old files stay readable through the authenticated route and
 * nginx refuses the public path (deploy/nginx.conf).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { storage } from '../src/server/storage';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.riderKycDocument.findMany({
    where: { fileUrl: { startsWith: '/uploads/rider-kyc/' } },
    select: { id: true, riderId: true, type: true, fileUrl: true, fileName: true, fileMimeType: true }
  });
  console.log(`${rows.length} legacy KYC file(s) found${apply ? '' : ' (dry run — pass --apply)'}`);
  let moved = 0;
  for (const r of rows) {
    if (r.fileUrl.includes('..')) continue;
    const src = path.join(process.cwd(), 'public', r.fileUrl);
    const data = await fs.readFile(src).catch(() => null);
    if (!data) {
      console.warn(`  missing on disk: ${r.id} ${r.fileUrl}`);
      continue;
    }
    if (!apply) continue;
    const { ref } = await storage().putPrivate(
      { name: r.fileName ?? path.basename(r.fileUrl), type: r.fileMimeType ?? 'application/octet-stream', data },
      { folder: `rider-kyc/${r.riderId}/${r.type}` }
    );
    const res = await prisma.riderKycDocument.updateMany({ where: { id: r.id, fileUrl: r.fileUrl }, data: { fileUrl: ref } });
    if (res.count === 1) {
      await fs.unlink(src).catch(() => {});
      moved++;
    }
  }
  console.log(apply ? `moved ${moved}` : 'dry run complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
