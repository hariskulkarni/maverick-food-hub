---
title: Set up delivery zones and fees
summary: Draw delivery areas as a polygon, a circle or a list of pincodes, and set fees by order value and distance, minimum order and ETA per zone.
audience: RESTAURANT_ADMIN
appArea: admin.delivery-zones
tags: delivery zones, delivery fee, pincode, radius, polygon, minimum order, eta
related: restaurant-branch-settings, restaurant-dedicated-riders, restaurant-live-tracking
language: en
---
## What it is

**Admin > Delivery Zones** decides where each branch delivers and what it charges. Once a branch has at least one active zone, zone rules replace the branch's simple base-plus-per-km fee.

## Create a zone

1. Open **Delivery Zones** and pick the **Branch**.
2. Tap **Add zone** and enter a **Zone name**.
3. Choose a **Zone type** and set the area (see below).
4. Set the options and fee rules, then tap **Create zone**.

Zone types:

- **Polygon (draw on map)** – tap **Draw polygon**, click each corner, then click the first point to close. Drag the handles to adjust.
- **Circle (radius)** – tap **Draw circle**, click the centre and drag out the radius.
- **Pincodes** – type pincodes and tap **Add**.

## Zone options

- **Priority (lower wins)** – when zones overlap, the lowest number is used.
- **Min order (₹)** – leave empty for none. If the branch also has a minimum, the higher one applies.
- **ETA override (min)** – leave empty for automatic (20 minutes plus 4 minutes per km).
- **Active** and **Default zone (fallback)** – the default zone is used for addresses outside every other zone.

## Fee rules

- **Fee brackets** charge by cart subtotal. Add rows of **Subtotal from (₹)** and **Charge (₹, 0 = free)**. The highest matching "from" amount applies. Turn on **Unavailable** for a bracket to refuse delivery in that range.
- **Distance tiers** add a charge by distance from the branch: **Up to (km)** and **Charge (₹)**.

## Good to know

- **New zones always get a starting bracket.** If you create a zone without adding any fee brackets, Flavrly adds one for you: from ₹0, charging the branch's base delivery fee. You can edit it afterwards.
- **A zone must keep at least one bracket.** When you edit a zone, removing every bracket is refused with "Add at least one fee bracket. A zone without fee brackets refuses every delivery." and the save button stays disabled until you add one.
- Keep a bracket that starts at ₹0. A subtotal below your lowest "from" amount has no matching bracket, so delivery is refused for that order.
- If zones exist and an address is outside all of them with no default zone, customers see that the address is outside your delivery area.
- Addresses without map coordinates can only match a pincode zone or the default zone.
- The delivery fee shown at checkout is the same one charged on the order.
