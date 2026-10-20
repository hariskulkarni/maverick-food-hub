import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  requireManagedRestaurant: vi.fn(),
  branchFindUnique: vi.fn(),
  zoneFindMany: vi.fn(),
  zoneFindUnique: vi.fn(),
  zoneCreate: vi.fn(),
  zoneUpdate: vi.fn(),
  zoneUpdateMany: vi.fn(),
  zoneDelete: vi.fn(),
}));

vi.mock("@/server/tenancy", () => ({ requireManagedRestaurant: m.requireManagedRestaurant }));
vi.mock("@/server/db", () => {
  const prisma: any = {
    branch: { findUnique: m.branchFindUnique },
    deliveryZone: {
      findMany: m.zoneFindMany,
      findUnique: m.zoneFindUnique,
      create: m.zoneCreate,
      update: m.zoneUpdate,
      updateMany: m.zoneUpdateMany,
      delete: m.zoneDelete,
    },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return { prisma };
});

import { GET, POST } from "@/app/api/admin/delivery-zones/route";
import { PATCH, DELETE } from "@/app/api/admin/delivery-zones/[id]/route";

const withUrl = (r: Request) => Object.assign(r, { nextUrl: new URL(r.url) }) as any;
const req = (url: string, method = "GET", body?: unknown) =>
  withUrl(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } }));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as any;
const URL0 = "http://x/api/admin/delivery-zones";

const polygon = [[77, 12], [77.1, 12], [77.1, 12.1]];
const validCircle = { branchId: "b1", name: "Near", type: "CIRCLE", centerLat: 12.9, centerLng: 77.6, radiusKm: 3 };

beforeEach(() => {
  vi.resetAllMocks();
  m.requireManagedRestaurant.mockResolvedValue({ id: "r1" });
  m.branchFindUnique.mockResolvedValue({ id: "b1", restaurantId: "r1" });
  m.zoneCreate.mockImplementation(async ({ data }: any) => ({ id: "z1", ...data }));
  m.zoneUpdate.mockImplementation(async ({ data }: any) => ({ id: "z1", ...data }));
  m.zoneUpdateMany.mockResolvedValue({ count: 0 });
  m.zoneFindMany.mockResolvedValue([]);
});

describe("auth", () => {
  it("returns the thrown Response (403) cleanly, not a 500", async () => {
    m.requireManagedRestaurant.mockRejectedValue(new Response("Forbidden", { status: 403 }));
    expect((await GET(req(`${URL0}?branchId=b1`))).status).toBe(403);
    expect((await POST(req(URL0, "POST", validCircle))).status).toBe(403);
    expect((await PATCH(req(`${URL0}/z1`, "PATCH", {}), ctx("z1"))).status).toBe(403);
    expect((await DELETE(req(`${URL0}/z1`, "DELETE"), ctx("z1"))).status).toBe(403);
  });
  it("rethrows non-Response errors", async () => {
    m.requireManagedRestaurant.mockRejectedValue(new Error("boom"));
    await expect(GET(req(`${URL0}?branchId=b1`))).rejects.toThrow("boom");
  });
});

describe("branch ownership", () => {
  beforeEach(() => m.branchFindUnique.mockResolvedValue({ id: "b9", restaurantId: "other" }));
  it("GET unmanaged branch -> 404, no zones queried", async () => {
    expect((await GET(req(`${URL0}?branchId=b9`))).status).toBe(404);
    expect(m.zoneFindMany).not.toHaveBeenCalled();
  });
  it("POST unmanaged branch -> 404, nothing created", async () => {
    expect((await POST(req(URL0, "POST", { ...validCircle, branchId: "b9" }))).status).toBe(404);
    expect(m.zoneCreate).not.toHaveBeenCalled();
  });
  it("PATCH/DELETE zone of unmanaged branch -> 404", async () => {
    m.zoneFindUnique.mockResolvedValue({ id: "z1", branchId: "b9", type: "CIRCLE", branch: { restaurantId: "other" } });
    expect((await PATCH(req(`${URL0}/z1`, "PATCH", { name: "x" }), ctx("z1"))).status).toBe(404);
    expect((await DELETE(req(`${URL0}/z1`, "DELETE"), ctx("z1"))).status).toBe(404);
    expect(m.zoneUpdate).not.toHaveBeenCalled();
    expect(m.zoneDelete).not.toHaveBeenCalled();
  });
  it("PATCH/DELETE missing zone -> 404", async () => {
    m.zoneFindUnique.mockResolvedValue(null);
    expect((await PATCH(req(`${URL0}/zz`, "PATCH", { name: "x" }), ctx("zz"))).status).toBe(404);
    expect((await DELETE(req(`${URL0}/zz`, "DELETE"), ctx("zz"))).status).toBe(404);
  });
});

describe("GET", () => {
  it("400 without branchId", async () => {
    expect((await GET(req(URL0))).status).toBe(400);
  });
  it("lists zones for a managed branch ordered by priority", async () => {
    m.zoneFindMany.mockResolvedValue([{ id: "z1" }]);
    const res = await GET(req(`${URL0}?branchId=b1`));
    expect(res.status).toBe(200);
    expect(m.zoneFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { branchId: "b1" }, orderBy: { priority: "asc" } }));
  });
});

describe("POST validation by type", () => {
  const post = (b: unknown) => POST(req(URL0, "POST", b));
  it("creates a valid CIRCLE", async () => {
    const res = await post(validCircle);
    expect(res.status).toBe(201);
    expect(m.zoneCreate).toHaveBeenCalled();
  });
  it("rejects CIRCLE without center or with radius<=0", async () => {
    expect((await post({ ...validCircle, centerLat: undefined })).status).toBe(400);
    expect((await post({ ...validCircle, radiusKm: 0 })).status).toBe(400);
  });
  it("POLYGON needs >=3 points", async () => {
    const base = { branchId: "b1", name: "P", type: "POLYGON" };
    expect((await post({ ...base, polygon: [[77, 12], [77.1, 12]] })).status).toBe(400);
    expect((await post({ ...base })).status).toBe(400);
    expect((await post({ ...base, polygon })).status).toBe(201);
  });
  it("PINCODE needs >=1 pincode", async () => {
    const base = { branchId: "b1", name: "Pin", type: "PINCODE" };
    expect((await post({ ...base, pincodes: [] })).status).toBe(400);
    expect((await post({ ...base, pincodes: ["560001"] })).status).toBe(201);
  });
  it("rejects unknown type and bad JSON", async () => {
    expect((await post({ ...validCircle, type: "SQUARE" })).status).toBe(400);
    const bad = withUrl(new Request(URL0, { method: "POST", body: "{nope" }));
    expect((await POST(bad)).status).toBe(400);
  });
  it("rejects invalid money shapes", async () => {
    expect((await post({ ...validCircle, feeBrackets: [{ minSubtotal: -5, charge: 10 }] })).status).toBe(400);
    expect((await post({ ...validCircle, feeBrackets: [{ minSubtotal: 0, charge: 1.5 }] })).status).toBe(400);
    expect((await post({ ...validCircle, distanceTiers: [{ uptoKm: 0, charge: 10 }] })).status).toBe(400);
  });
  it("stores money exactly as given (paise brackets/tiers, rupees minOrder)", async () => {
    await post({
      ...validCircle,
      feeBrackets: [{ minSubtotal: 50000, charge: 0 }, { minSubtotal: 0, charge: 4000 }, { minSubtotal: 0, charge: -1 }],
      distanceTiers: [{ uptoKm: 5, charge: 2000 }],
      minOrder: 199.5,
    });
    const data = m.zoneCreate.mock.calls[0][0].data;
    expect(data.feeBrackets[0]).toEqual({ minSubtotal: 50000, charge: 0 });
    expect(data.distanceTiers).toEqual([{ uptoKm: 5, charge: 2000 }]);
    expect(data.minOrder).toBe(199.5);
  });
});

describe("isDefault uniqueness", () => {
  it("POST isDefault unsets other defaults on the branch first", async () => {
    await POST(req(URL0, "POST", { ...validCircle, isDefault: true }));
    expect(m.zoneUpdateMany).toHaveBeenCalledWith({ where: { branchId: "b1", isDefault: true }, data: { isDefault: false } });
    expect(m.zoneCreate).toHaveBeenCalled();
  });
  it("POST non-default does not touch others", async () => {
    await POST(req(URL0, "POST", validCircle));
    expect(m.zoneUpdateMany).not.toHaveBeenCalled();
  });
  it("PATCH isDefault true unsets others except itself", async () => {
    m.zoneFindUnique.mockResolvedValue({ id: "z1", branchId: "b1", type: "CIRCLE", name: "n", centerLat: 1, centerLng: 2, radiusKm: 3, branch: { restaurantId: "r1" } });
    const res = await PATCH(req(`${URL0}/z1`, "PATCH", { isDefault: true }), ctx("z1"));
    expect(res.status).toBe(200);
    expect(m.zoneUpdateMany).toHaveBeenCalledWith({ where: { branchId: "b1", isDefault: true, id: { not: "z1" } }, data: { isDefault: false } });
  });
});

describe("PATCH / DELETE", () => {
  const existing = { id: "z1", branchId: "b1", type: "CIRCLE", name: "n", centerLat: 1, centerLng: 2, radiusKm: 3, pincodes: [], branch: { restaurantId: "r1" } };
  beforeEach(() => m.zoneFindUnique.mockResolvedValue(existing));
  it("PATCH partial update on managed zone", async () => {
    const res = await PATCH(req(`${URL0}/z1`, "PATCH", { name: "New" }), ctx("z1"));
    expect(res.status).toBe(200);
    expect(m.zoneUpdate.mock.calls[0][0].where).toEqual({ id: "z1" });
  });
  it("PATCH validates merged geometry (radius<=0 rejected)", async () => {
    expect((await PATCH(req(`${URL0}/z1`, "PATCH", { radiusKm: -1 }), ctx("z1"))).status).toBe(400);
  });
  it("PATCH changing type requires that type's geometry", async () => {
    expect((await PATCH(req(`${URL0}/z1`, "PATCH", { type: "PINCODE" }), ctx("z1"))).status).toBe(400);
    expect((await PATCH(req(`${URL0}/z1`, "PATCH", { type: "PINCODE", pincodes: ["560001"] }), ctx("z1"))).status).toBe(200);
  });
  it("PATCH cannot move zone to an unmanaged branch", async () => {
    m.branchFindUnique.mockResolvedValue({ id: "b9", restaurantId: "other" });
    expect((await PATCH(req(`${URL0}/z1`, "PATCH", { branchId: "b9" }), ctx("z1"))).status).toBe(404);
  });
  it("DELETE managed zone", async () => {
    const res = await DELETE(req(`${URL0}/z1`, "DELETE"), ctx("z1"));
    expect(res.status).toBe(200);
    expect(m.zoneDelete).toHaveBeenCalledWith({ where: { id: "z1" } });
  });
});
