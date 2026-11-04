-- AlterEnum: Novaryq completion outbox (FNI N-09 / F-07).
ALTER TYPE "NovaryqSyncState" ADD VALUE 'COMPLETE_PENDING';
ALTER TYPE "NovaryqSyncState" ADD VALUE 'COMPLETED';
