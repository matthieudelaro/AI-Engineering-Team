# MEMORY — Backend

Role-specific learnings for the Backend engineer. Keep current: replace outdated
lines in place. Team-wide learnings go in the root `MEMORY.md`.

## Notes
- Gateway UI claim queue (`game/src/gateway/uiClaimQueue.ts`): `GET /_gateway/ui-claim-queue`
  returns `getUiClaimQueueStats()` (pending/inFlight/total/pendingRetries + fifo `head`
  preview, max 10). `DELETE /_gateway/ui-claim-queue` calls `clearUiClaimQueue()` (204).
  Tests use `resetUiClaimQueue()` — same implementation as clear.
