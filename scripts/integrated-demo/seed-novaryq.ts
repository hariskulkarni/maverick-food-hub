/**
 * Integrated demo — Novaryq India tenant "Flavrly Test Kitchen" (LOCAL ONLY, fake data).
 *
 * Runs inside a scratch Novaryq worktree (copied to apps/api/qa-demo/ by up.sh) AFTER the stock
 * `prisma/seed.ts`, against a disposable ci_* database. Mirrors the shapes the stock seed uses
 * (PlatformService.createTenant + provisionFullLocation): tenant + Owner role/user, one IN
 * location (INR, IST, a clearly fake test GSTIN), GST 5 % tax rate, Cook/Manager employees with
 * PINs, KDS stations, a menu with HSN/SAC-tagged items + modifiers, and the SCALE plan.
 * Prints the values up.sh needs as KEY=VALUE lines. Idempotent on the fixed ids below.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLE_PRESETS, resolveProfile } from '@novaryq/shared';

const prisma = new PrismaClient();
const D = (v: string) => new Prisma.Decimal(v);
const J = (v: unknown) => v as Prisma.InputJsonValue;

const ID = {
  tenant: '11111111-f1a7-4e1a-9d00-000000000001',
  location: '11111111-f1a7-4e1a-9d00-000000000002',
  menu: 'menu-11111111-f1a7-4e1a-9d00-000000000002',
};
export const DEMO = {
  tenantSlug: 'flavrly-test-kitchen',
  locationSlug: 'flavrlytestkitchen',
  ownerEmail: 'owner@flavrly-test-kitchen.demo',
  ownerPassword: 'Demo-Passw0rd!', // local demo only
  gstin: '29AAAAA0000A1Z5', // well-known SAMPLE GSTIN format — not a real registration
};

const MODS = [
  { key: 'spice', name: 'Spice level', min: 0, max: 1, required: false, options: [{ name: 'Mild', delta: '0.00' }, { name: 'Extra spicy', delta: '0.00' }] },
  { key: 'addons', name: 'Add-ons', min: 0, max: 3, required: false, options: [{ name: 'Extra paneer', delta: '40.00' }, { name: 'Extra raita', delta: '30.00' }] },
];
const MENU = [
  { name: 'Starters', items: [
    { name: 'Paneer Tikka', sku: 'FTK-PANEER-TIKKA', price: '249.00', hsn: '996331', prep: 'GRILL', mods: ['spice', 'addons'], desc: 'Charred cottage cheese, mint chutney' },
    { name: 'Veg Samosa (2 pc)', sku: 'FTK-SAMOSA', price: '79.00', hsn: '996331', prep: 'FRY', mods: [], desc: 'Potato and pea filling' },
  ] },
  { name: 'Mains', items: [
    { name: 'Hyderabadi Veg Biryani', sku: 'FTK-VEG-BIRYANI', price: '299.00', hsn: '996331', prep: 'SAUTE', mods: ['spice', 'addons'], desc: 'Dum-cooked basmati, raita on the side' },
    { name: 'Dal Makhani', sku: 'FTK-DAL-MAKHANI', price: '219.00', hsn: '996331', prep: 'SAUTE', mods: ['spice'], desc: 'Slow-cooked black lentils' },
    { name: 'Butter Naan', sku: 'FTK-BUTTER-NAAN', price: '59.00', hsn: '996331', prep: 'GRILL', mods: [], desc: 'Tandoor flatbread' },
  ] },
  { name: 'Drinks', items: [
    { name: 'Mango Lassi', sku: 'FTK-MANGO-LASSI', price: '99.00', hsn: '996331', prep: 'EXPO', mods: [], desc: 'Alphonso mango, yoghurt' },
  ] },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO.ownerPassword, 10);
  const tenant = await prisma.tenant.upsert({
    where: { id: ID.tenant },
    update: {},
    create: {
      id: ID.tenant, name: 'Flavrly Test Kitchen', slug: DEMO.tenantSlug,
      country: 'IN' as any, countryConfirmed: true, featureFlags: J({ plan: 'scale' }),
    },
  });
  let ownerRole = await prisma.role.findFirst({ where: { tenantId: tenant.id, name: 'Owner' } });
  ownerRole ??= await prisma.role.create({ data: { tenantId: tenant.id, name: 'Owner', isSystem: true, permissions: J(ROLE_PRESETS.Owner) } });
  let owner = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: DEMO.ownerEmail } });
  owner ??= await prisma.user.create({ data: { tenantId: tenant.id, email: DEMO.ownerEmail, passwordHash, fullName: 'Asha Rao (demo owner)', isPlatformAdmin: false } });
  if (!(await prisma.userRole.findFirst({ where: { userId: owner.id, roleId: ownerRole.id } }))) {
    await prisma.userRole.create({ data: { userId: owner.id, roleId: ownerRole.id } });
  }
  if (!(await prisma.tenantSubscription.findFirst({ where: { tenantId: tenant.id } }))) {
    await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, planKey: 'scale', status: 'ACTIVE', selectedAddOns: J([]), perOutlet: true } });
  }

  const existing = await prisma.location.findUnique({ where: { id: ID.location } });
  if (existing) await prisma.location.update({ where: { id: ID.location }, data: { profile: J(resolveProfile('QUICK_SERVICE' as any)) } });
  if (!existing) {
    await prisma.location.create({
      data: {
        id: ID.location, tenantId: tenant.id, name: 'Flavrly Test Kitchen — Indiranagar', businessType: 'QUICK_SERVICE' as any,
        slug: DEMO.locationSlug, country: 'IN' as any, currency: 'INR', timezone: 'Asia/Kolkata',
        city: 'Bengaluru', region: 'Karnataka', postalCode: '560038',
        addressLine1: '12 Demo Road, Indiranagar', phone: '+919800000001', taxRegistrationNumber: DEMO.gstin,
        // Segment profile (modules: POS, KDS, …) exactly as provisionFullLocation sets it.
        profile: J(resolveProfile('QUICK_SERVICE' as any)),
        onlineOrdering: J({ enabled: false }),
      } as any,
    });
    await prisma.taxRate.create({ data: { tenantId: tenant.id, locationId: ID.location, name: 'GST 5%', taxClass: 'standard', rate: D('0.05') } });
    for (const emp of [
      { fullName: 'Ravi (Cook)', pin: '2468', jobTitle: 'Line Cook', preset: 'Cook' },
      { fullName: 'Meera (Manager)', pin: '1357', jobTitle: 'Shift Manager', preset: 'Manager' },
    ] as const) {
      await prisma.employee.create({
        data: { tenantId: tenant.id, locationId: ID.location, fullName: emp.fullName, pinHash: await bcrypt.hash(emp.pin, 10), jobTitle: emp.jobTitle, permissions: J(ROLE_PRESETS[emp.preset]) },
      });
    }
    for (const st of [
      { name: 'Tandoor / Grill', type: 'GRILL', keys: ['GRILL'] },
      { name: 'Hot line', type: 'SAUTE', keys: ['SAUTE', 'FRY'] },
      { name: 'Expo / Pickup', type: 'EXPO', keys: ['EXPO'] },
    ]) {
      await prisma.kdsStation.create({ data: { tenantId: tenant.id, locationId: ID.location, name: st.name, type: st.type as any, routingKeys: J(st.keys) } });
    }
    const menu = await prisma.menu.create({ data: { id: ID.menu, tenantId: tenant.id, name: 'Flavrly Test Kitchen Menu' } });
    await prisma.locationMenu.create({ data: { locationId: ID.location, menuId: menu.id } });
    const groups = new Map<string, string>();
    for (const mg of MODS) {
      const g = await prisma.modifierGroup.create({ data: { tenantId: tenant.id, name: mg.name, minSelect: mg.min, maxSelect: mg.max, isRequired: mg.required } });
      let so = 0;
      for (const o of mg.options) await prisma.modifier.create({ data: { tenantId: tenant.id, modifierGroupId: g.id, name: o.name, priceDelta: D(o.delta), sortOrder: so++ } });
      groups.set(mg.key, g.id);
    }
    let cs = 0;
    for (const cat of MENU) {
      const c = await prisma.category.create({ data: { tenantId: tenant.id, menuId: menu.id, name: cat.name, sortOrder: cs++ } });
      let is = 0;
      for (const it of cat.items) {
        const item = await prisma.menuItem.create({
          data: { tenantId: tenant.id, categoryId: c.id, name: it.name, description: it.desc, sku: it.sku, basePrice: D(it.price), hsnCode: it.hsn, taxClass: 'standard', prepStation: it.prep, prepSeconds: 300, sortOrder: is++ } as any,
        });
        let ms = 0;
        for (const k of it.mods) await prisma.itemModifierGroup.create({ data: { menuItemId: item.id, modifierGroupId: groups.get(k)!, sortOrder: ms++ } });
      }
    }
  }
  console.log(`NQ_TENANT_ID=${tenant.id}`);
  console.log(`NQ_LOCATION_ID=${ID.location}`);
  console.log(`NQ_LOCATION_SLUG=${DEMO.locationSlug}`);
  console.log(`NQ_OWNER_EMAIL=${DEMO.ownerEmail}`);
  console.log(`NQ_OWNER_PASSWORD=${DEMO.ownerPassword}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
