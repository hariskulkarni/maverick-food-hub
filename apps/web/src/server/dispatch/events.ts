/**
 * Order event log — append-only dispatch milestones (OrderEvent table).
 *
 * OrderStatusEvent only stores the order-status enum; dispatch telemetry needs
 * milestones that are not order statuses (INVITED, ASSIGNED, ARRIVED_RESTAURANT
 * while the order is still READY), a source (system/kitchen/rider/admin) and an
 * optional rider fix. Writers call `recordOrderEvent` from the existing code
 * paths (transitionOrder, claim/assign/invite routes, rider step routes).
 *
 * Never throws: telemetry must not break an order flow.
 */
import { OrderEventSource, OrderEventType, OrderStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';

/** Milestones that can only happen once per order. Replays become no-ops. */
const ONCE: ReadonlySet<OrderEventType> = new Set<OrderEventType>([
  OrderEventType.ACCEPTED,
  OrderEventType.PREP_STARTED,
  OrderEventType.FOOD_READY,
  OrderEventType.ARRIVED_RESTAURANT,
  OrderEventType.PICKED_UP,
  OrderEventType.ARRIVED_CUSTOMER,
  OrderEventType.DELIVERED,
  OrderEventType.CANCELLED,
]);

export interface OrderEventInput {
  orderId: string;
  type: OrderEventType;
  source: OrderEventSource;
  at?: Date;
  actorId?: string | null;
  riderId?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Override the default dedupe key (ONCE types default to the type name; others to NULL). */
  dedupeKey?: string | null;
  meta?: Record<string, unknown>;
}

/** Default dedupe key: the type for once-only milestones, NULL (always insert) otherwise. */
export function dedupeKeyFor(type: OrderEventType, override?: string | null): string | null {
  if (override !== undefined) return override;
  return ONCE.has(type) ? type : null;
}

/** Map an order-status transition to the milestone it represents (or null). */
export function eventTypeForStatus(status: OrderStatus): OrderEventType | null {
  switch (status) {
    case OrderStatus.ACCEPTED: return OrderEventType.ACCEPTED;
    case OrderStatus.PREPARING: return OrderEventType.PREP_STARTED;
    case OrderStatus.READY: return OrderEventType.FOOD_READY;
    case OrderStatus.RIDER_ASSIGNED: return OrderEventType.ASSIGNED;
    case OrderStatus.RIDER_REACHED_RESTAURANT: return OrderEventType.ARRIVED_RESTAURANT;
    case OrderStatus.PICKED_UP:
    case OrderStatus.OUT_FOR_DELIVERY: return OrderEventType.PICKED_UP;
    case OrderStatus.RIDER_REACHED_CUSTOMER: return OrderEventType.ARRIVED_CUSTOMER;
    case OrderStatus.DELIVERED: return OrderEventType.DELIVERED;
    case OrderStatus.CANCELLED:
    case OrderStatus.CANCELLED_BY_CUSTOMER:
    case OrderStatus.CANCELLED_BY_RESTAURANT:
    case OrderStatus.CANCELLED_BY_ADMIN: return OrderEventType.CANCELLED;
    default: return null;
  }
}

/**
 * Who is acting, by session role. Restaurant staff (KITCHEN and the
 * restaurant's own ADMIN) count as KITCHEN — that is what the merchant
 * ready-tap rate measures. Platform roles are ADMIN.
 */
export function sourceForRole(role: string | null | undefined): OrderEventSource {
  switch (role) {
    case Role.KITCHEN:
    case Role.ADMIN:
      return OrderEventSource.KITCHEN;
    case Role.RIDER:
      return OrderEventSource.RIDER;
    case undefined:
    case null:
    case '':
      return OrderEventSource.SYSTEM;
    default:
      return OrderEventSource.ADMIN;
  }
}

/** Append one event. Idempotent for once-only milestones. Returns true if a row was written. */
export async function recordOrderEvent(input: OrderEventInput): Promise<boolean> {
  try {
    const res = await prisma.orderEvent.createMany({
      data: [
        {
          orderId: input.orderId,
          type: input.type,
          source: input.source,
          at: input.at ?? new Date(),
          actorId: input.actorId ?? null,
          riderId: input.riderId ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          dedupeKey: dedupeKeyFor(input.type, input.dedupeKey),
          meta: (input.meta as Prisma.InputJsonValue | undefined) ?? undefined,
        },
      ],
      skipDuplicates: true,
    });
    return res.count > 0;
  } catch (e) {
    safeWarn({ err: (e as Error).message, orderId: input.orderId, type: input.type }, 'order event write failed');
    return false;
  }
}

/** Logging must never throw out of a telemetry path (some test doubles stub only part of `log`). */
export function safeWarn(obj: Record<string, unknown>, msg: string): void {
  try {
    log.warn(obj, msg);
  } catch {
    /* ignore */
  }
}

/** Best-effort lookup of a rider's last stored fix (RiderProfile.currentLat/Lng) for event stamping. */
export async function riderFix(riderId: string): Promise<{ lat: number | null; lng: number | null }> {
  try {
    const r = await prisma.riderProfile.findUnique({ where: { id: riderId }, select: { currentLat: true, currentLng: true } });
    return { lat: r?.currentLat ?? null, lng: r?.currentLng ?? null };
  } catch {
    return { lat: null, lng: null };
  }
}

/**
 * Raw-SQL timestamp parameter. Prisma columns are `timestamp(3)` holding UTC,
 * but Prisma sends a JS Date as `timestamptz`; comparing the two makes Postgres
 * apply the SESSION time zone. Normalising the parameter to a UTC `timestamp`
 * keeps every comparison correct whatever the server/session TZ is.
 */
export function utcTs(d: Date): Prisma.Sql {
  return Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;
}
