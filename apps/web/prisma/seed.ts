/**
 * Seed: one branch ("Combo Nation — Benz Circle"), full menu, an admin,
 * a kitchen user, two riders, two customers, and a handful of historic orders
 * so the dashboard isn't empty on first run.
 */

import {
  PrismaClient,
  Role,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  AssignmentStatus,
  RestaurantStatus,
  EscalationType,
  EscalationSeverity,
  EscalationStatus,
  CodStatus,
  TicketType,
  TicketStatus,
  TicketPriority,
  QrType
} from '@prisma/client';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { FOOD_IMAGES, COMBO_IMAGES, CATEGORY_IMAGES, FOOD_FALLBACK } from '../src/lib/food-images';

const prisma = new PrismaClient();

async function main() {
  console.log('▶︎ Seeding database…');

  // ── Users (passwords) ────────────────────────────────────────────────────
  const adminPass = await argon2.hash('Admin@12345');
  const kitchenPass = await argon2.hash('Kitchen@12345');
  const superPass = await argon2.hash('Super@12345');

  // ── Platform super admin ──────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'super@platform.local' },
    update: { role: Role.SUPER_ADMIN, passwordHash: superPass },
    create: {
      email: 'super@platform.local',
      role: Role.SUPER_ADMIN,
      name: 'Platform Owner',
      passwordHash: superPass
    }
  });

  // ── Restaurant owner (Combo Nation) ────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: 'admin@restaurant.local' },
    update: { passwordHash: adminPass, role: Role.ADMIN },
    create: {
      email: 'admin@restaurant.local',
      role: Role.ADMIN,
      name: 'Aarav (Owner)',
      passwordHash: adminPass
    }
  });

  // ── Restaurant ────────────────────────────────────────────────────────────
  const restaurant = await prisma.restaurant.upsert({
    where: { slug: 'saffron-smoke' },
    update: { status: RestaurantStatus.ACTIVE, approvedAt: new Date() },
    create: {
      slug: 'saffron-smoke',
      name: 'Combo Nation',
      tagline: 'Modern kitchen, classic cravings.',
      description: 'Slow-cooked biryanis, charcoal-grilled tikkas, and the kind of comfort food that turns a Tuesday around.',
      cuisine: 'Indian',
      contactEmail: 'hello@saffronsmoke.local',
      contactPhone: '+918001234567',
      status: RestaurantStatus.ACTIVE,
      approvedAt: new Date(),
      ownerUserId: admin.id,
      logoUrl: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=200&auto=format&fit=crop&q=80',
      coverImageUrl: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=1600&auto=format&fit=crop&q=80'
    }
  });

  await prisma.restaurantUser.upsert({
    where: { restaurantId_userId: { restaurantId: restaurant.id, userId: admin.id } },
    update: {},
    create: { restaurantId: restaurant.id, userId: admin.id, role: Role.ADMIN }
  });

  // ── Branch (now linked to restaurant) ─────────────────────────────────────
  const branch = await prisma.branch.upsert({
    where: { slug: 'saffron-smoke-indiranagar' },
    update: { restaurantId: restaurant.id },
    create: {
      restaurantId: restaurant.id,
      name: 'Combo Nation — Brodipet',
      slug: 'saffron-smoke-indiranagar',
      phone: '+918001234567',
      email: 'benzcircle@saffronsmoke.local',
      line1: '12, Brodipet Main Road',
      city: 'Guntur',
      state: 'AP',
      postalCode: '522002',
      country: 'IN',
      latitude: 16.3010,
      longitude: 80.4360,
      serviceRadiusKm: 8,
      taxRatePct: 5.0,
      baseDeliveryFee: 40 as any,
      perKmDeliveryFee: 8 as any,
      hours: {
        create: Array.from({ length: 7 }).map((_, i) => ({
          dayOfWeek: i,
          openMin: 11 * 60,
          closeMin: 23 * 60
        }))
      }
    }
  });

  const kitchen = await prisma.user.upsert({
    where: { email: 'kitchen@restaurant.local' },
    update: { passwordHash: kitchenPass, role: Role.KITCHEN },
    create: {
      email: 'kitchen@restaurant.local',
      role: Role.KITCHEN,
      name: 'Kitchen Counter',
      passwordHash: kitchenPass
    }
  });
  await prisma.restaurantUser.upsert({
    where: { restaurantId_userId: { restaurantId: restaurant.id, userId: kitchen.id } },
    update: {},
    create: { restaurantId: restaurant.id, userId: kitchen.id, role: Role.KITCHEN }
  });

  // ── Sample second restaurant (PENDING — for super-admin to approve) ──────
  const owner2 = await prisma.user.upsert({
    where: { email: 'owner@spice-route.local' },
    update: { passwordHash: adminPass, role: Role.ADMIN },
    create: {
      email: 'owner@spice-route.local',
      role: Role.ADMIN,
      name: 'Maya (Spice Route)',
      passwordHash: adminPass
    }
  });
  const restaurant2 = await prisma.restaurant.upsert({
    where: { slug: 'spice-route' },
    update: {},
    create: {
      slug: 'spice-route',
      name: 'Spice Route',
      tagline: 'Coastal flavours, slow-cooked at home.',
      cuisine: 'Indian',
      contactEmail: 'hello@spice-route.local',
      contactPhone: '+918007654321',
      status: RestaurantStatus.PENDING,
      ownerUserId: owner2.id,
      coverImageUrl: 'https://images.unsplash.com/photo-1772730065344-4cf131b39951?w=1600&auto=format&fit=crop&q=80'
    }
  });
  await prisma.restaurantUser.upsert({
    where: { restaurantId_userId: { restaurantId: restaurant2.id, userId: owner2.id } },
    update: {},
    create: { restaurantId: restaurant2.id, userId: owner2.id, role: Role.ADMIN }
  });

  // ── Default delivery payout rule ─────────────────────────────────────────
  await prisma.deliveryPayoutRule.upsert({
    where: { id: 'seed-payout-default' },
    update: {},
    create: {
      id: 'seed-payout-default',
      name: 'Default v1',
      baseAmount: 30 as any,
      perKmAmount: 5 as any,
      peakHourBonus: 10 as any,
      rainBonus: 15 as any,
      isActive: true
    }
  });

  // ── Sample pending rider application (now platform-level) ────────────────
  await prisma.riderApplication.upsert({
    where: { phone: '+919876500099' },
    update: {},
    create: {
      restaurantId: restaurant.id, // optional hint — platform decides
      name: 'Vikas T.',
      phone: '+919876500099',
      vehicleType: 'BIKE',
      vehicleNumber: 'AP-16-XY-9999',
      preferredZone: 'Brodipet / Arundelpet',
      notes: 'Available 7am–11pm.'
    }
  });

  const customer1 = await prisma.user.upsert({
    where: { phone: '+919876500001' },
    update: {},
    create: {
      role: Role.CUSTOMER,
      name: 'Priya Iyer',
      phone: '+919876500001',
      addresses: {
        create: {
          label: 'Home',
          line1: '402, Lotus Apartments',
          line2: '5th Cross, Brodipet',
          city: 'Guntur',
          state: 'AP',
          postalCode: '522002',
          latitude: 16.3025,
          longitude: 80.4375,
          isDefault: true
        }
      }
    }
  });

  const customer2 = await prisma.user.upsert({
    where: { phone: '+919876500002' },
    update: {},
    create: {
      role: Role.CUSTOMER,
      name: 'Rahul Mehta',
      phone: '+919876500002',
      addresses: {
        create: {
          label: 'Office',
          line1: 'Building B, Arundelpet Tech Park',
          city: 'Guntur',
          state: 'AP',
          postalCode: '522002',
          latitude: 16.3055,
          longitude: 80.4425,
          isDefault: true
        }
      }
    }
  });

  const riderUser1 = await prisma.user.upsert({
    where: { phone: '+919876500011' },
    update: {},
    create: { role: Role.RIDER, name: 'Sandeep K.', phone: '+919876500011' }
  });
  const riderUser2 = await prisma.user.upsert({
    where: { phone: '+919876500012' },
    update: {},
    create: { role: Role.RIDER, name: 'Imran S.', phone: '+919876500012' }
  });

  // Riders are platform-pool now — branchId is just a home-base hint, optional
  await prisma.riderProfile.upsert({
    where: { userId: riderUser1.id },
    update: { approvedAt: new Date() },
    create: { userId: riderUser1.id, branchId: branch.id, vehicleType: 'BIKE', vehicleNumber: 'AP-16-AB-1234', isOnline: true, approvedAt: new Date() }
  });
  await prisma.riderProfile.upsert({
    where: { userId: riderUser2.id },
    update: { approvedAt: new Date() },
    create: { userId: riderUser2.id, branchId: branch.id, vehicleType: 'BIKE', vehicleNumber: 'AP-16-CD-5678', isOnline: true, approvedAt: new Date() }
  });

  // wallet + loyalty for customers
  for (const c of [customer1, customer2]) {
    await prisma.wallet.upsert({ where: { userId: c.id }, update: {}, create: { userId: c.id, balance: 250 as any } });
    await prisma.loyaltyAccount.upsert({ where: { userId: c.id }, update: {}, create: { userId: c.id, pointsBalance: 120, lifetimeEarn: 120 } });
  }

  // ── Categories + Menu ────────────────────────────────────────────────────
  const categoryDefs = [
    { slug: 'biryani', name: 'Biryani' },
    { slug: 'starters', name: 'Starters' },
    { slug: 'mains', name: 'Mains' },
    { slug: 'breads', name: 'Breads' },
    { slug: 'desserts', name: 'Desserts' },
    { slug: 'beverages', name: 'Beverages' }
  ];
  const cats: Record<string, string> = {};
  for (let i = 0; i < categoryDefs.length; i++) {
    const c = await prisma.category.upsert({
      where: { branchId_slug: { branchId: branch.id, slug: categoryDefs[i].slug } },
      update: { imageUrl: CATEGORY_IMAGES[categoryDefs[i].slug] },
      create: {
        branchId: branch.id,
        slug: categoryDefs[i].slug,
        name: categoryDefs[i].name,
        imageUrl: CATEGORY_IMAGES[categoryDefs[i].slug],
        sortOrder: i
      }
    });
    cats[c.slug] = c.id;
  }

  type Item = { slug: string; name: string; cat: string; price: number; veg: boolean; popular?: boolean; recommended?: boolean; spicy?: number; prep?: number; desc: string };
  const items: Item[] = [
    { slug: 'hyderabadi-chicken-biryani', name: 'Hyderabadi Chicken Biryani', cat: 'biryani', price: 320, veg: false, popular: true, recommended: true, spicy: 2, prep: 25, desc: 'Long-grain basmati, slow-cooked dum, hand-cut chicken, saffron and fried onions.' },
    { slug: 'lucknowi-mutton-biryani', name: 'Lucknowi Mutton Biryani', cat: 'biryani', price: 420, veg: false, popular: true, spicy: 2, prep: 35, desc: 'Awadhi-style aromatics, slow-braised mutton, mild rosewater finish.' },
    { slug: 'paneer-tikka-biryani', name: 'Paneer Tikka Biryani', cat: 'biryani', price: 290, veg: true, recommended: true, spicy: 1, prep: 22, desc: 'Charred paneer, smoked basmati, mint and burnt-onion crunch.' },
    { slug: 'veg-dum-biryani', name: 'Vegetable Dum Biryani', cat: 'biryani', price: 240, veg: true, spicy: 1, prep: 22, desc: 'Mixed vegetables, whole spices, sealed and slow-cooked.' },
    { slug: 'chicken-65', name: 'Chicken 65', cat: 'starters', price: 260, veg: false, popular: true, spicy: 3, prep: 15, desc: 'Crispy bone-in chicken, curry leaves, green chillies.' },
    { slug: 'paneer-tikka', name: 'Paneer Tikka', cat: 'starters', price: 240, veg: true, recommended: true, spicy: 1, prep: 15, desc: 'Charcoal-grilled cottage cheese, capsicum, onion, tandoor smoke.' },
    { slug: 'gobi-65', name: 'Gobi 65', cat: 'starters', price: 200, veg: true, spicy: 2, prep: 12, desc: 'Crispy cauliflower, fiery South-Indian masala, fresh curry leaves.' },
    { slug: 'butter-chicken', name: 'Butter Chicken', cat: 'mains', price: 340, veg: false, popular: true, spicy: 1, prep: 20, desc: 'Tandoor-cooked chicken in a silky tomato-cream gravy.' },
    { slug: 'dal-makhani', name: 'Dal Makhani', cat: 'mains', price: 240, veg: true, recommended: true, spicy: 1, prep: 18, desc: 'Black urad and rajma, slow-simmered overnight, finished with cream.' },
    { slug: 'paneer-butter-masala', name: 'Paneer Butter Masala', cat: 'mains', price: 280, veg: true, spicy: 1, prep: 18, desc: 'Tomato-cashew gravy, soft paneer cubes, fenugreek aroma.' },
    { slug: 'butter-naan', name: 'Butter Naan', cat: 'breads', price: 60, veg: true, spicy: 0, prep: 7, desc: 'Tandoor-baked, brushed with white butter.' },
    { slug: 'garlic-naan', name: 'Garlic Naan', cat: 'breads', price: 80, veg: true, spicy: 0, prep: 7, desc: 'Roasted garlic and coriander.' },
    { slug: 'gulab-jamun', name: 'Gulab Jamun (2 pc)', cat: 'desserts', price: 100, veg: true, spicy: 0, prep: 5, desc: 'Warm khoya dumplings, cardamom-rose syrup.' },
    { slug: 'phirni', name: 'Kesar Phirni', cat: 'desserts', price: 130, veg: true, spicy: 0, prep: 5, desc: 'Slow-cooked rice pudding, saffron, pistachio shards.' },
    { slug: 'masala-chai', name: 'Masala Chai', cat: 'beverages', price: 50, veg: true, spicy: 0, prep: 4, desc: 'Strong, spiced, lots of cardamom.' },
    { slug: 'sweet-lassi', name: 'Sweet Lassi', cat: 'beverages', price: 90, veg: true, spicy: 0, prep: 4, desc: 'Hung curd, sugar, a touch of rose.' },
    { slug: 'cola', name: 'Cola (300ml)', cat: 'beverages', price: 50, veg: true, spicy: 0, prep: 1, desc: 'Chilled.' }
  ];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await prisma.menuItem.upsert({
      where: { branchId_slug: { branchId: branch.id, slug: it.slug } },
      update: { imageUrl: FOOD_IMAGES[it.slug] },
      create: {
        branchId: branch.id,
        categoryId: cats[it.cat],
        name: it.name,
        slug: it.slug,
        description: it.desc,
        price: it.price as any,
        isVeg: it.veg,
        spicyLevel: it.spicy ?? 0,
        prepTimeMin: it.prep ?? 20,
        imageUrl: FOOD_IMAGES[it.slug],
        isPopular: !!it.popular,
        isRecommended: !!it.recommended,
        sortOrder: i
      }
    });
  }

  // ── Combos ────────────────────────────────────────────────────────────────
  const biryani = await prisma.menuItem.findUniqueOrThrow({ where: { branchId_slug: { branchId: branch.id, slug: 'hyderabadi-chicken-biryani' } } });
  const starter = await prisma.menuItem.findUniqueOrThrow({ where: { branchId_slug: { branchId: branch.id, slug: 'chicken-65' } } });
  const drink = await prisma.menuItem.findUniqueOrThrow({ where: { branchId_slug: { branchId: branch.id, slug: 'cola' } } });

  await prisma.combo.upsert({
    where: { branchId_slug: { branchId: branch.id, slug: 'biryani-feast' } },
    update: { imageUrl: COMBO_IMAGES['biryani-feast'] },
    create: {
      branchId: branch.id,
      slug: 'biryani-feast',
      name: 'Biryani Feast for One',
      description: 'Hyderabadi Chicken Biryani + Chicken 65 + Cola',
      price: 540 as any,
      imageUrl: COMBO_IMAGES['biryani-feast'],
      items: {
        create: [
          { menuItemId: biryani.id, quantity: 1 },
          { menuItemId: starter.id, quantity: 1 },
          { menuItemId: drink.id, quantity: 1 }
        ]
      },
      sortOrder: 0
    }
  });

  // ── Coupon ───────────────────────────────────────────────────────────────
  await prisma.coupon.upsert({
    where: { code: 'WELCOME50' },
    update: {},
    create: {
      code: 'WELCOME50',
      description: '₹50 off first order',
      flatOff: 50 as any,
      minOrderAmount: 250 as any,
      perUserLimit: 1,
      usageLimit: 1000
    }
  });

  // ── Sample orders for Combo Nation (idempotent via known order codes) ──
  // Re-running the seed will skip any code that already exists.
  const customer1Address = await prisma.address.findFirstOrThrow({ where: { userId: customer1.id } });

  type SeededOrder = {
    code: string;
    customerId: string;
    addressId: string;
    status: OrderStatus;
    minutesAgo: number;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
  };
  const seededOrders: SeededOrder[] = [
    // 1. PAYMENT_PENDING — Razorpay handoff still in flight
    { code: 'ORD-SEED01', customerId: customer1.id, addressId: customer1Address.id, status: OrderStatus.PAYMENT_PENDING, minutesAgo: 5, paymentMethod: PaymentMethod.RAZORPAY, paymentStatus: PaymentStatus.PENDING },
    // 2. DELIVERED yesterday (COD — drives one of the pending reconciliations)
    { code: 'ORD-SEED02', customerId: customer1.id, addressId: customer1Address.id, status: OrderStatus.DELIVERED, minutesAgo: 24 * 60, paymentMethod: PaymentMethod.COD, paymentStatus: PaymentStatus.CAPTURED },
    // 3. DELIVERED 2 days ago (COD — second pending reconciliation)
    { code: 'ORD-SEED03', customerId: customer2.id, addressId: customer1Address.id, status: OrderStatus.DELIVERED, minutesAgo: 48 * 60, paymentMethod: PaymentMethod.COD, paymentStatus: PaymentStatus.CAPTURED },
    // 4. ACCEPTED just now
    { code: 'ORD-SEED04', customerId: customer1.id, addressId: customer1Address.id, status: OrderStatus.ACCEPTED, minutesAgo: 1, paymentMethod: PaymentMethod.RAZORPAY, paymentStatus: PaymentStatus.CAPTURED },
    // 5. OUT_FOR_DELIVERY — gets a RiderAssignment + DeliveryLocationPing
    { code: 'ORD-SEED05', customerId: customer2.id, addressId: customer1Address.id, status: OrderStatus.OUT_FOR_DELIVERY, minutesAgo: 25, paymentMethod: PaymentMethod.RAZORPAY, paymentStatus: PaymentStatus.CAPTURED }
  ];

  const createdSeedOrders: Record<string, { id: string; total: number; placedAt: Date }> = {};
  for (const s of seededOrders) {
    const existing = await prisma.order.findUnique({ where: { code: s.code } });
    if (existing) {
      createdSeedOrders[s.code] = { id: existing.id, total: Number(existing.total), placedAt: existing.placedAt };
      continue;
    }
    const item = biryani;
    const qty = 1;
    const subtotal = Number(item.price) * qty;
    const tax = +(subtotal * 0.05).toFixed(2);
    const fee = 40;
    const total = +(subtotal + tax + fee).toFixed(2);
    const placedAt = new Date(Date.now() - s.minutesAgo * 60_000);
    const isPostAccept = s.status !== OrderStatus.PAYMENT_PENDING && s.status !== OrderStatus.RECEIVED;
    const isPrepOrLater = ['PREPARING','READY','RIDER_ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED'].includes(s.status);
    const isReadyOrLater = ['READY','RIDER_ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED'].includes(s.status);
    const isOfdOrLater = ['OUT_FOR_DELIVERY','DELIVERED'].includes(s.status);
    const isDelivered = s.status === OrderStatus.DELIVERED;

    const created = await prisma.order.create({
      data: {
        code: s.code,
        branchId: branch.id,
        customerId: s.customerId,
        addressId: s.addressId,
        status: s.status,
        subtotal: subtotal as any,
        taxAmount: tax as any,
        deliveryFee: fee as any,
        total: total as any,
        paymentMethod: s.paymentMethod,
        placedAt,
        acceptedAt: isPostAccept ? new Date(placedAt.getTime() + 60_000) : null,
        preparingAt: isPrepOrLater ? new Date(placedAt.getTime() + 90_000) : null,
        readyAt: isReadyOrLater ? new Date(placedAt.getTime() + 18 * 60_000) : null,
        outForDeliveryAt: isOfdOrLater ? new Date(placedAt.getTime() + 22 * 60_000) : null,
        deliveredAt: isDelivered ? new Date(placedAt.getTime() + 38 * 60_000) : null,
        deliveryOtp: isOfdOrLater ? '4242' : null,
        items: { create: [{ menuItemId: item.id, name: item.name, quantity: qty, unitPrice: item.price }] },
        statusEvents: {
          create: [
            { status: OrderStatus.RECEIVED, createdAt: placedAt },
            ...(isPostAccept ? [{ status: OrderStatus.ACCEPTED, createdAt: new Date(placedAt.getTime() + 60_000) }] : []),
            ...(isPrepOrLater ? [{ status: OrderStatus.PREPARING, createdAt: new Date(placedAt.getTime() + 90_000) }] : []),
            ...(isReadyOrLater ? [{ status: OrderStatus.READY, createdAt: new Date(placedAt.getTime() + 18 * 60_000) }] : []),
            ...(isOfdOrLater ? [{ status: OrderStatus.OUT_FOR_DELIVERY, createdAt: new Date(placedAt.getTime() + 22 * 60_000) }] : []),
            ...(isDelivered ? [{ status: OrderStatus.DELIVERED, createdAt: new Date(placedAt.getTime() + 38 * 60_000) }] : [])
          ]
        },
        payments: {
          create: {
            method: s.paymentMethod,
            status: s.paymentStatus,
            amount: total as any,
            providerName: s.paymentMethod === PaymentMethod.COD ? 'cod' : 'mock',
            providerRef: s.paymentMethod === PaymentMethod.COD ? null : 'mock_' + nanoid(8)
          }
        }
      }
    });
    createdSeedOrders[s.code] = { id: created.id, total, placedAt };
  }

  // ── Rider assignment + GPS ping for OUT_FOR_DELIVERY order ───────────────
  const ofd = createdSeedOrders['ORD-SEED05'];
  const sandeepProfile = await prisma.riderProfile.findUniqueOrThrow({ where: { userId: riderUser1.id } });
  if (ofd) {
    await prisma.riderAssignment.upsert({
      where: { orderId: ofd.id },
      update: {},
      create: {
        orderId: ofd.id,
        riderId: sandeepProfile.id,
        status: AssignmentStatus.PICKED_UP,
        claimedAt: new Date(ofd.placedAt.getTime() + 19 * 60_000),
        acceptedAt: new Date(ofd.placedAt.getTime() + 19 * 60_000),
        pickedUpAt: new Date(ofd.placedAt.getTime() + 22 * 60_000),
        baseEarningsAmt: 30 as any,
        bonusAmt: 10 as any,
        earningsAmt: 40 as any
      }
    });
    // A recent GPS ping ~30s ago, just south of the customer's address
    const recentPing = await prisma.deliveryLocationPing.findFirst({
      where: { orderId: ofd.id },
      orderBy: { createdAt: 'desc' }
    });
    if (!recentPing || Date.now() - recentPing.createdAt.getTime() > 60_000) {
      await prisma.deliveryLocationPing.create({
        data: {
          riderId: sandeepProfile.id,
          orderId: ofd.id,
          lat: 16.3018,
          lng: 80.4368,
          speedKph: 18,
          createdAt: new Date(Date.now() - 30 * 1000)
        }
      });
    }
  }

  // ── Pending COD reconciliations for Sandeep (₹250 + ₹200 = ₹450) ─────────
  const codTargets = [
    { code: 'ORD-SEED02', amount: 250 },
    { code: 'ORD-SEED03', amount: 200 }
  ];
  for (const c of codTargets) {
    const o = createdSeedOrders[c.code];
    if (!o) continue;
    await prisma.codCollection.upsert({
      where: { orderId: o.id },
      update: {},
      create: {
        orderId: o.id,
        riderId: sandeepProfile.id,
        amountToCollect: c.amount as any,
        status: CodStatus.PENDING_COLLECTION
      }
    });
  }

  // ── Open escalations ─────────────────────────────────────────────────────
  // MEDIUM ORDER_NOT_ACCEPTED on the oldest delivered test order (treat as
  // "old test order" — uses one of the seeded codes so re-running stays stable).
  const oldOrder = createdSeedOrders['ORD-SEED03'];
  if (oldOrder) {
    const exists = await prisma.orderEscalation.findFirst({
      where: { orderId: oldOrder.id, type: EscalationType.ORDER_NOT_ACCEPTED }
    });
    if (!exists) {
      await prisma.orderEscalation.create({
        data: {
          orderId: oldOrder.id,
          type: EscalationType.ORDER_NOT_ACCEPTED,
          severity: EscalationSeverity.MEDIUM,
          status: EscalationStatus.OPEN,
          message: 'Restaurant did not accept within SLA on this historic order.'
        }
      });
    }
  }
  // HIGH NO_RIDER_AVAILABLE on a READY order — create one if absent.
  let readyOrder = await prisma.order.findUnique({ where: { code: 'ORD-SEED06' } });
  if (!readyOrder) {
    const placedAt = new Date(Date.now() - 12 * 60_000);
    const subtotal = Number(biryani.price);
    const tax = +(subtotal * 0.05).toFixed(2);
    const fee = 40;
    const total = +(subtotal + tax + fee).toFixed(2);
    readyOrder = await prisma.order.create({
      data: {
        code: 'ORD-SEED06',
        branchId: branch.id,
        customerId: customer1.id,
        addressId: customer1Address.id,
        status: OrderStatus.READY,
        subtotal: subtotal as any,
        taxAmount: tax as any,
        deliveryFee: fee as any,
        total: total as any,
        paymentMethod: PaymentMethod.RAZORPAY,
        placedAt,
        acceptedAt: new Date(placedAt.getTime() + 60_000),
        preparingAt: new Date(placedAt.getTime() + 90_000),
        readyAt: new Date(placedAt.getTime() + 10 * 60_000),
        items: { create: [{ menuItemId: biryani.id, name: biryani.name, quantity: 1, unitPrice: biryani.price }] },
        statusEvents: {
          create: [
            { status: OrderStatus.RECEIVED, createdAt: placedAt },
            { status: OrderStatus.ACCEPTED, createdAt: new Date(placedAt.getTime() + 60_000) },
            { status: OrderStatus.PREPARING, createdAt: new Date(placedAt.getTime() + 90_000) },
            { status: OrderStatus.READY, createdAt: new Date(placedAt.getTime() + 10 * 60_000) }
          ]
        },
        payments: {
          create: { method: PaymentMethod.RAZORPAY, status: PaymentStatus.CAPTURED, amount: total as any, providerName: 'mock', providerRef: 'mock_' + nanoid(8) }
        }
      }
    });
  }
  const noRiderExists = await prisma.orderEscalation.findFirst({
    where: { orderId: readyOrder.id, type: EscalationType.NO_RIDER_AVAILABLE }
  });
  if (!noRiderExists) {
    await prisma.orderEscalation.create({
      data: {
        orderId: readyOrder.id,
        type: EscalationType.NO_RIDER_AVAILABLE,
        severity: EscalationSeverity.HIGH,
        status: EscalationStatus.OPEN,
        message: 'Order ready 10+ min, no rider has claimed yet.'
      }
    });
  }

  // ── Support ticket from Priya (ORDER_DELAY / HIGH / OPEN) ────────────────
  const priyaTicketAnchor = createdSeedOrders['ORD-SEED04']?.id ?? null;
  const existingTicket = await prisma.supportTicket.findFirst({
    where: { customerId: customer1.id, type: TicketType.ORDER_DELAY, status: TicketStatus.OPEN }
  });
  if (!existingTicket) {
    await prisma.supportTicket.create({
      data: {
        customerId: customer1.id,
        orderId: priyaTicketAnchor,
        restaurantId: restaurant.id,
        type: TicketType.ORDER_DELAY,
        status: TicketStatus.OPEN,
        priority: TicketPriority.HIGH,
        message: 'My order is taking much longer than the estimated time. Please check.'
      }
    });
  }

  // ── QR codes for Combo Nation ─────────────────────────────────────────
  await prisma.qrCode.upsert({
    where: { code: 'saffron-restaurant' },
    update: {},
    create: {
      code: 'saffron-restaurant',
      restaurantId: restaurant.id,
      branchId: branch.id,
      type: QrType.RESTAURANT,
      isActive: true
    }
  });
  await prisma.qrCode.upsert({
    where: { code: 'saffron-table-t12' },
    update: {},
    create: {
      code: 'saffron-table-t12',
      restaurantId: restaurant.id,
      branchId: branch.id,
      tableId: 'T-12',
      type: QrType.TABLE,
      isActive: true
    }
  });

  // ── Favorites for Priya ──────────────────────────────────────────────────
  await prisma.favoriteRestaurant.upsert({
    where: { userId_restaurantId: { userId: customer1.id, restaurantId: restaurant.id } },
    update: {},
    create: { userId: customer1.id, restaurantId: restaurant.id }
  });
  await prisma.favoriteItem.upsert({
    where: { userId_menuItemId: { userId: customer1.id, menuItemId: biryani.id } },
    update: {},
    create: { userId: customer1.id, menuItemId: biryani.id }
  });

  // ── Wrap n Roll (third restaurant, ACTIVE, Italian) ────────────────────
  const owner3 = await prisma.user.upsert({
    where: { email: 'admin@bistro-cinque.local' },
    update: { passwordHash: adminPass, role: Role.ADMIN },
    create: {
      email: 'admin@bistro-cinque.local',
      role: Role.ADMIN,
      name: 'Luca (Wrap n Roll)',
      passwordHash: adminPass
    }
  });
  const restaurant3 = await prisma.restaurant.upsert({
    where: { slug: 'bistro-cinque' },
    update: { status: RestaurantStatus.ACTIVE, approvedAt: new Date() },
    create: {
      slug: 'bistro-cinque',
      name: 'Wrap n Roll',
      tagline: 'Wood-fired pies, hand-rolled pasta, Italian comfort.',
      description: 'A neighborhood Italian kitchen — sourdough pizzas, slow-braised ragùs, and tiramisu the way nonna intended.',
      cuisine: 'Italian',
      contactEmail: 'hello@bistro-cinque.local',
      contactPhone: '+918009999500',
      status: RestaurantStatus.ACTIVE,
      approvedAt: new Date(),
      ownerUserId: owner3.id,
      logoUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=200&auto=format&fit=crop&q=80',
      coverImageUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1600&auto=format&fit=crop&q=80'
    }
  });
  await prisma.restaurantUser.upsert({
    where: { restaurantId_userId: { restaurantId: restaurant3.id, userId: owner3.id } },
    update: {},
    create: { restaurantId: restaurant3.id, userId: owner3.id, role: Role.ADMIN }
  });

  const branch3 = await prisma.branch.upsert({
    where: { slug: 'bistro-cinque-koramangala' },
    update: { restaurantId: restaurant3.id },
    create: {
      restaurantId: restaurant3.id,
      name: 'Wrap n Roll — AT Agraharam',
      slug: 'bistro-cinque-koramangala',
      phone: '+918009999500',
      email: 'beachroad@bistro-cinque.local',
      line1: 'AT Agraharam Main Road',
      city: 'Guntur',
      state: 'AP',
      postalCode: '522004',
      country: 'IN',
      latitude: 16.3000,
      longitude: 80.4320,
      serviceRadiusKm: 7,
      taxRatePct: 5.0,
      baseDeliveryFee: 40 as any,
      perKmDeliveryFee: 8 as any,
      hours: {
        create: Array.from({ length: 7 }).map((_, i) => ({
          dayOfWeek: i,
          openMin: 12 * 60,
          closeMin: 23 * 60
        }))
      }
    }
  });

  // Italian categories
  const italianCatDefs = [
    { slug: 'pizza', name: 'Pizza' },
    { slug: 'pasta', name: 'Pasta' },
    { slug: 'salad', name: 'Salad' },
    { slug: 'dessert', name: 'Dessert' }
  ];
  const italianCats: Record<string, string> = {};
  for (let i = 0; i < italianCatDefs.length; i++) {
    const c = await prisma.category.upsert({
      where: { branchId_slug: { branchId: branch3.id, slug: italianCatDefs[i].slug } },
      update: {},
      create: {
        branchId: branch3.id,
        slug: italianCatDefs[i].slug,
        name: italianCatDefs[i].name,
        sortOrder: i
      }
    });
    italianCats[c.slug] = c.id;
  }

  // 12 Italian items — uses guessable Unsplash IDs; falls back to FOOD_FALLBACK
  const italianImages: Record<string, string> = {
    'margherita-pizza': 'https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=800&auto=format&fit=crop&q=80',
    'pepperoni-pizza': 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&auto=format&fit=crop&q=80',
    'quattro-formaggi': 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop&q=80',
    'truffle-mushroom-pizza': 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&auto=format&fit=crop&q=80',
    'spaghetti-carbonara': 'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=800&auto=format&fit=crop&q=80',
    'penne-arrabbiata': 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=800&auto=format&fit=crop&q=80',
    'fettuccine-alfredo': 'https://images.unsplash.com/photo-1645112411341-6c4fd023714a?w=800&auto=format&fit=crop&q=80',
    'lasagna-bolognese': 'https://images.unsplash.com/photo-1734770931927-6410f9a64832?w=800&auto=format&fit=crop&q=80',
    'caprese-salad': 'https://images.unsplash.com/photo-1592417817098-8fd3d9eb14a5?w=800&auto=format&fit=crop&q=80',
    'caesar-salad': 'https://images.unsplash.com/photo-1551248429-40975aa4de74?w=800&auto=format&fit=crop&q=80',
    'tiramisu': 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=800&auto=format&fit=crop&q=80',
    'panna-cotta': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&auto=format&fit=crop&q=80'
  };

  type ItalianItem = { slug: string; name: string; cat: string; price: number; veg: boolean; popular?: boolean; recommended?: boolean; spicy?: number; prep?: number; desc: string };
  const italianItems: ItalianItem[] = [
    { slug: 'margherita-pizza', name: 'Margherita Pizza', cat: 'pizza', price: 380, veg: true, popular: true, recommended: true, spicy: 0, prep: 18, desc: 'San Marzano tomato, fior di latte, fresh basil, wood-fired crust.' },
    { slug: 'pepperoni-pizza', name: 'Pepperoni Pizza', cat: 'pizza', price: 460, veg: false, popular: true, spicy: 1, prep: 18, desc: 'Spicy cured pepperoni, mozzarella, tomato base.' },
    { slug: 'quattro-formaggi', name: 'Quattro Formaggi', cat: 'pizza', price: 480, veg: true, spicy: 0, prep: 18, desc: 'Four-cheese blend — mozzarella, gorgonzola, fontina, parmigiano.' },
    { slug: 'truffle-mushroom-pizza', name: 'Truffle Mushroom Pizza', cat: 'pizza', price: 520, veg: true, recommended: true, spicy: 0, prep: 20, desc: 'Wild mushrooms, truffle oil, mozzarella, fresh thyme.' },
    { slug: 'spaghetti-carbonara', name: 'Spaghetti Carbonara', cat: 'pasta', price: 420, veg: false, popular: true, spicy: 0, prep: 15, desc: 'Guanciale, egg yolk, pecorino, cracked black pepper.' },
    { slug: 'penne-arrabbiata', name: 'Penne Arrabbiata', cat: 'pasta', price: 360, veg: true, spicy: 2, prep: 14, desc: 'Fiery tomato sauce, garlic, chilli, parsley.' },
    { slug: 'fettuccine-alfredo', name: 'Fettuccine Alfredo', cat: 'pasta', price: 380, veg: true, recommended: true, spicy: 0, prep: 14, desc: 'Hand-cut fettuccine in butter-parmigiano cream.' },
    { slug: 'lasagna-bolognese', name: 'Lasagna Bolognese', cat: 'pasta', price: 440, veg: false, spicy: 0, prep: 22, desc: 'Slow-cooked beef ragù, béchamel, parmigiano, baked golden.' },
    { slug: 'caprese-salad', name: 'Caprese Salad', cat: 'salad', price: 280, veg: true, recommended: true, spicy: 0, prep: 8, desc: 'Buffalo mozzarella, heirloom tomato, basil, olive oil.' },
    { slug: 'caesar-salad', name: 'Caesar Salad', cat: 'salad', price: 260, veg: true, spicy: 0, prep: 8, desc: 'Cos lettuce, anchovy dressing, croutons, parmigiano shavings.' },
    { slug: 'tiramisu', name: 'Tiramisu', cat: 'dessert', price: 220, veg: true, popular: true, spicy: 0, prep: 5, desc: 'Espresso-soaked savoiardi, mascarpone cream, cocoa.' },
    { slug: 'panna-cotta', name: 'Panna Cotta', cat: 'dessert', price: 200, veg: true, spicy: 0, prep: 5, desc: 'Vanilla bean cream, berry compote.' }
  ];

  for (let i = 0; i < italianItems.length; i++) {
    const it = italianItems[i];
    await prisma.menuItem.upsert({
      where: { branchId_slug: { branchId: branch3.id, slug: it.slug } },
      update: { imageUrl: italianImages[it.slug] ?? FOOD_FALLBACK },
      create: {
        branchId: branch3.id,
        categoryId: italianCats[it.cat],
        name: it.name,
        slug: it.slug,
        description: it.desc,
        price: it.price as any,
        isVeg: it.veg,
        spicyLevel: it.spicy ?? 0,
        prepTimeMin: it.prep ?? 18,
        imageUrl: italianImages[it.slug] ?? FOOD_FALLBACK,
        isPopular: !!it.popular,
        isRecommended: !!it.recommended,
        sortOrder: i
      }
    });
  }

  console.log('✓ Seed complete.');
  console.log('  Super admin:    super@platform.local / Super@12345  → /platform');
  console.log('  Restaurant 1:   admin@restaurant.local / Admin@12345  → /admin   (Combo Nation, ACTIVE, Indian — 17 items + 1 combo)');
  console.log('  Restaurant 2:   owner@spice-route.local / Admin@12345 → /admin   (Spice Route, PENDING — approve at /platform)');
  console.log('  Restaurant 3:   admin@bistro-cinque.local / Admin@12345 → /admin (Wrap n Roll, ACTIVE, Italian — 12 items, AT Agraharam branch)');
  console.log('  Kitchen:        kitchen@restaurant.local / Kitchen@12345 → /kitchen');
  console.log('  Customer:       +919876500001  (Priya — favorites Combo Nation + Hyderabadi Biryani)');
  console.log('  Customer:       +919876500002  (Rahul)');
  console.log('  Rider:          +919876500011  (Sandeep K. — has active OFD delivery + 2 pending COD reconciliations = ₹450)');
  console.log('  Rider:          +919876500012  (Imran S.)');
  console.log('  Sample orders:  5 on Combo Nation (codes ORD-SEED01..05) + 1 READY order ORD-SEED06 with open NO_RIDER_AVAILABLE escalation');
  console.log('                  PAYMENT_PENDING / DELIVERED×2 (COD) / ACCEPTED / OUT_FOR_DELIVERY (rider claimed, GPS ping 30s ago)');
  console.log('  Escalations:    1 MEDIUM ORDER_NOT_ACCEPTED + 1 HIGH NO_RIDER_AVAILABLE — both OPEN');
  console.log('  Support ticket: 1 OPEN ORDER_DELAY (HIGH) from Priya');
  console.log('  COD pending:    ₹250 + ₹200 = ₹450 across Sandeep’s 2 delivered COD orders');
  console.log('  QR codes:       saffron-restaurant (RESTAURANT) + saffron-table-t12 (TABLE T-12)');
  console.log('  Favorites:      Priya → Combo Nation + Hyderabadi Chicken Biryani');
  console.log('  Payout rule:    Default v1 (active)');
  console.log('  Coupon:         WELCOME50 (₹50 off, min order ₹250)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
