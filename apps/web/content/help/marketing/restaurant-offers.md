---
title: Create offers and automatic discounts
summary: Build percentage, flat, buy-X-get-Y, combo, free-item, first-order and repeat-customer offers that apply automatically or with a promo code.
audience: RESTAURANT_ADMIN
appArea: admin.offers
tags: offers, auto-apply, bogo, buy x get y, first order, free item, promo code, stackable
related: restaurant-coupons, restaurant-happy-hours, restaurant-coupon-campaigns
language: en
---
## What it is

Offers are flexible promotions with their own eligibility rules. Find them under **Storefront CMS > Promotions > Offers**. The top of the page shows **Active offers**, **Auto-apply**, **Redemptions this month** and your **Top performer**.

## Offer types

- **Percentage** – X% off, optionally capped.
- **Flat off** – a fixed rupee amount off.
- **Buy X get Y** – buy a number of qualifying items, get some free or discounted.
- **Combo** – a bundle of items at a combined price.
- **Free item** – a free menu item when the cart reaches a threshold.
- **First order** – only on a customer's very first order.
- **Repeat customer** – unlocks after a number of completed orders.
- **Dine-in → Online** and **Online → Dine-in** – cross-channel offers (usually created by [coupon campaigns](help:restaurant-coupon-campaigns)).

## Create an offer

1. Tap **New offer** and choose the **Offer type**.
2. Enter an **Internal name**, an optional **Promo code** and a **Customer-facing description**.
3. Fill in the reward fields for that type.
4. Optionally limit it by **Branch**, **Categories**, **Items**, **Fulfillment types** (Delivery, Pickup, Dine-in), **Active days & time window**, **Min order (₹)** and **Min completed orders**.
5. Set **Total usage limit** (0 = unlimited), **Per-user limit**, **Valid from** and **Valid until** (blank = no end).
6. Choose the switches: **Active**, **Auto-apply** (no code needed) and **Stackable** (combines with others), and a **Priority (higher wins)**.
7. Check the live preview, then tap **Create offer**.

## How offers are chosen

- Auto-apply offers are found automatically at checkout. Code offers apply when the customer enters the code.
- Among non-stackable offers, the one with the highest priority wins, then the biggest discount.
- Stackable offers can combine as long as they don't discount the same cart line. If a single non-stackable offer is worth more, it is used instead.
- Offers apply on top of any happy-hour prices.

## Good to know

- Leave all fulfillment types unchecked to apply to every type.
- To stop an offer, turn off **Active** or deactivate it from the editor.
