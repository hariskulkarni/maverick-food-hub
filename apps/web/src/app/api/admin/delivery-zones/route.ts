import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireManagedRestaurant } from "@/server/tenancy";
import { ZoneBody, zoneData } from "@/server/delivery/zone-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve the managed restaurant; a thrown Response (401/403/404) becomes the reply. */
async function managed(req: NextRequest) {
  try {
    return { restaurant: await requireManagedRestaurant(req.nextUrl.searchParams.get("restaurantId")) };
  } catch (e) {
    if (e instanceof Response) return { error: e };
    throw e;
  }
}

/** 404 (not 403) for a branch outside the caller's restaurant, so ids don't leak across tenants. */
async function ownsBranch(restaurantId: string, branchId: string) {
  const b = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, restaurantId: true } });
  return !!b && b.restaurantId === restaurantId;
}

export async function GET(req: NextRequest) {
  const m = await managed(req);
  if (m.error) return m.error;
  const branchId = req.nextUrl.searchParams.get("branchId");
  if (!branchId) return new Response("branchId required", { status: 400 });
  if (!(await ownsBranch(m.restaurant!.id, branchId))) return new Response("Not found", { status: 404 });
  const zones = await prisma.deliveryZone.findMany({ where: { branchId }, orderBy: { priority: "asc" } });
  return Response.json({ zones });
}

export async function POST(req: NextRequest) {
  const m = await managed(req);
  if (m.error) return m.error;
  const raw = await req.json().catch(() => null);
  const parsed = ZoneBody.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid zone", issues: parsed.error.issues }, { status: 400 });
  const v = parsed.data;
  if (!(await ownsBranch(m.restaurant!.id, v.branchId))) return new Response("Not found", { status: 404 });

  const zone = await prisma.$transaction(async (tx) => {
    if (v.isDefault) {
      await tx.deliveryZone.updateMany({ where: { branchId: v.branchId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.deliveryZone.create({ data: zoneData(v) as never });
  });
  return Response.json({ zone }, { status: 201 });
}
