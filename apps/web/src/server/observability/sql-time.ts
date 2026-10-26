/**
 * Timezone-safe timestamps for raw SQL. Prisma stores DateTime as UTC in
 * `timestamp(3)` (no zone) columns, but a JS Date bound into $queryRaw is sent
 * as timestamptz and silently converted with the DB session TimeZone — which
 * on a VPS set to IST shifts every comparison by 5h30. Always go through ts().
 */
import { Prisma } from '@prisma/client';

/** A UTC `timestamp` literal for raw SQL, independent of the session TimeZone. */
export function ts(d: Date | number): Prisma.Sql {
  return Prisma.sql`(${new Date(d).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}
