// S1 part B: operator re-imports the same statement file, and a different file repeating the same
// credit row. Neither creates a second bank transaction or allocation.
import { note, scenario, staffLogin, sqlVal, importStatement } from './uat-lib.mjs';
import fs from 'node:fs';
const ok = (c) => (c ? 'PASS' : 'FAIL');
scenario('s01-happy-path');
const E = process.env.EVID || '/Users/bunny../flavrly-pg-evidence/2026-10-24/agent-s';
const accId = sqlVal(`select id from "PgReceivingAccount" where status='VERIFIED' limit 1`);
const admin = await staffLogin('admin');
const csv = fs.readFileSync(`${E}/s01-happy-path/s01-statement-610100000101.csv`, 'utf8').trim().split('\n');
const [, row] = csv;
const [date, , ref, , amount] = row.split(',');
const c0 = sqlVal(`select count(*)||'/'||(select count(*) from "PgAllocation") from "PgBankTransaction"`);
const same = await importStatement(admin, accId, [{ date, ref, amount }], 's01-statement-610100000101.csv');
const other = await importStatement(admin, accId, [{ date, ref, amount }, { date, ref: 'UATUNMATCHED0001', amount: '1.00' }], 's01b-statement-overlap.csv');
const c1 = sqlVal(`select count(*)||'/'||(select count(*) from "PgAllocation") from "PgBankTransaction"`);
note(`bank txns/allocations before ${c0} after ${c1}`);
note(`EXPECT identical file -> duplicateFile; overlapping file -> 1 duplicate row + 1 new UNMATCHED credit, no new allocation: ${ok(same.json?.duplicateFile === true && other.json?.duplicateCount === 1 && other.json?.insertedCount === 1 && c0.split('/')[1] === c1.split('/')[1])}`);
note(`unmatched credit stays visible: ${sqlVal(`select status from "PgBankTransaction" where "bankReference"='UATUNMATCHED0001'`)}`);
