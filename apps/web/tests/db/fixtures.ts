/** Minimal real-DB fixtures for rider-flow tests. */
import { PaymentMethod, PaymentStatus, OrderStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/server/db';

let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function makeRestaurant() {
  const owner = await prisma.user.create({ data: { role: 'ADMIN', phone: `+9170${uid().slice(-8)}`, name: 'Owner' } });
  const restaurant = await prisma.restaurant.create({ data: { slug: `r-${uid()}`, name: 'Test Kitchen', ownerUserId: owner.id } });
  const branch = await prisma.branch.create({
    data: { restaurantId: restaurant.id, slug: `b-${uid()}`, name: 'Main', line1: '1 MG Road', city: 'Pune', postalCode: '411001', latitude: 18.52, longitude: 73.85 }
  });
  return { owner, restaurant, branch };
}

export async function makeRider(opts: { approved?: boolean; online?: boolean } = {}) {
  const user = await prisma.user.create({ data: { role: 'RIDER', phone: `+9180${uid().slice(-8)}`, name: 'Rider' } });
  const profile = await prisma.riderProfile.create({
    data: { userId: user.id, approvedAt: opts.approved === false ? null : new Date(), isOnline: opts.online ?? true }
  });
  return { user, profile };
}

export async function makeOrder(
  branchId: string,
  opts: { status?: OrderStatus; paymentMethod?: PaymentMethod; total?: number; otp?: string } = {}
) {
  const customer = await prisma.user.create({ data: { role: 'CUSTOMER', phone: `+9190${uid().slice(-8)}`, name: 'Cust' } });
  const address = await prisma.address.create({
    data: { userId: customer.id, line1: '9 FC Road', city: 'Pune', postalCode: '411004', latitude: 18.53, longitude: 73.84 }
  });
  const total = opts.total ?? 450;
  const order = await prisma.order.create({
    data: {
      code: `ORD-${uid().toUpperCase()}`,
      branchId,
      customerId: customer.id,
      addressId: address.id,
      subtotal: total,
      total,
      paymentMethod: opts.paymentMethod ?? PaymentMethod.COD,
      status: opts.status ?? OrderStatus.READY,
      deliveryOtp: opts.otp ?? '4821',
      readyAt: new Date()
    }
  });
  if ((opts.paymentMethod ?? PaymentMethod.COD) === PaymentMethod.COD) {
    await prisma.payment.create({
      data: { orderId: order.id, method: PaymentMethod.COD, status: PaymentStatus.PENDING, amount: total, currency: 'INR', providerName: 'cod' }
    });
  }
  return { order, customer };
}

export async function makeAssignment(data: Prisma.RiderAssignmentUncheckedCreateInput, bumpLoad = true) {
  const a = await prisma.riderAssignment.create({ data });
  if (bumpLoad) await prisma.riderProfile.update({ where: { id: data.riderId }, data: { currentLoad: { increment: 1 } } });
  return a;
}

export async function approveAllKyc(riderId: string) {
  for (const type of ['AADHAAR', 'DRIVING_LICENSE', 'VEHICLE_RC', 'VEHICLE_INSURANCE'] as const) {
    await prisma.riderKycDocument.create({
      data: { riderId, type, status: 'APPROVED', fileUrl: 'private:test', expiresOn: new Date(Date.now() + 365 * 86400000) }
    });
  }
}
