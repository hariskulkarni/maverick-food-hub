---
title: Manage dedicated riders and dispatch mode
summary: Choose whether ready orders go to the platform rider fleet, only your own riders, or your riders first, and add or remove dedicated riders.
audience: RESTAURANT_ADMIN
appArea: admin.riders
tags: riders, dedicated riders, dispatch, fleet, rider pool, fallback
related: restaurant-live-tracking, restaurant-order-statuses, restaurant-delivery-zones
language: en
---
## What it is

When a delivery order is marked **Ready**, a rider has to claim it. **Admin > Dedicated Riders** controls who can claim your orders and lets you keep your own roster of riders.

## Choose a dispatch mode

Under **Dispatch mode**, pick one:

- **Fleet only** – ready orders go straight to the platform-wide rider pool. Any online rider can claim them. This is the default.
- **Dedicated only** – only riders dedicated to your restaurant can claim your orders. Orders wait until one of your riders is free.
- **Dedicated first, then fleet** – your riders get first chance. If none claims the order within the **Fleet fallback window (minutes)**, it opens to the platform fleet.

The fallback window must be between 1 and 120 minutes (default 5). Tap **Save dispatch mode** to apply.

## Add a dedicated rider

1. Tap **Add rider** (or **Add dedicated rider** when your roster is empty).
2. Enter the **Rider phone number** of a rider already registered and approved on the platform.
3. Tap **Add rider**. The rider moves from the platform fleet to your roster.

You will see an error if no rider has that number, the rider is not yet approved, or the rider is already dedicated to another restaurant (or already to yours).

## Your roster

The list shows each rider's name, phone, **Online** or **Offline** status, rating, deliveries and vehicle.

## Remove a rider

Use the remove action on the rider's row, then tap **Remove rider** in the confirmation. The rider returns to the platform-wide fleet. You can add them again later by phone number.

## Good to know

- In a restaurant group, dedicated riders are shared across the group – any of them can take orders from any restaurant in the group.
- Pickup and dine-in orders never go to riders.
- See where riders are right now on [Live tracking](help:restaurant-live-tracking).
