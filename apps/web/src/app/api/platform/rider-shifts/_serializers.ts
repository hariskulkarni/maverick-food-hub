/**
 * Serializer for RiderShift rows. Lives outside `route.ts` because a Next.js
 * route file may only export HTTP handlers + route config.
 */
export function serializeShift(s: any) {
  return {
    id: s.id,
    riderId: s.riderId,
    // `@db.Date` — keep only the calendar date portion.
    date: s.date.toISOString().slice(0, 10),
    startTime: s.startTime,
    endTime: s.endTime,
    zoneName: s.zoneName ?? null,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    rider: {
      id: s.rider?.id ?? s.riderId,
      name: s.rider?.user?.name ?? null,
      phone: s.rider?.user?.phone ?? null,
    },
  };
}
