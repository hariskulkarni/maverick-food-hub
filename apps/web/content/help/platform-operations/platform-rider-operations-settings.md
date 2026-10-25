---
title: Platform team: rider operations settings (super admin)
summary: For Flavrly super admins. What each platform-wide rider rule on Platform → Rider settings does, its default, and who it affects before you change it.
audience: ALL
appArea: platform.rider-settings
tags: super admin, platform, rider settings, kyc gate, training gate, concurrent orders, order cap, earnings goals, dispatch, jit
related: rider-kyc-documents, rider-training
language: en
---
This page is for the Flavrly platform team. Only a **Super Admin** can open **Platform → Rider operations → Rider settings** or change these values. Restaurants and riders cannot see or change them.

Every save takes effect straight away for all riders and is recorded in **Platform → Audit log** as `platform.rider-settings.update`, with the values before and after.

## KYC gate (default: on)

When on, a rider can only go online, claim an order from the pool, accept a batch invitation or be assigned by a restaurant when all four required documents are **approved** and **not expired**: Aadhaar, driving licence, vehicle RC and vehicle insurance. PAN is not needed for this check.

- An expired document still counts for **3 days** (grace), so a renewal waiting for review doesn't stop the rider.
- Riders who fail the check and are already online stop getting new orders at once. They are not pushed offline, but they can't go online again until their documents are approved.
- The nightly KYC expiry sweep takes riders offline when a document expires, and texts them which document to renew.

Before you switch it, the page shows how many active riders fail the check right now, how many of them are online, and which documents are missing. A confirmation step appears both when turning it on and when turning it off. Keep it on unless you have a clear reason.

## Safety training gate (default: off)

When on, a rider can't go online until they have passed every required rider training module marked **blocks shift**, at its current version. It is checked only when the rider taps **Go online**: riders already online are not pushed offline, and going offline is never blocked.

The page shows how many active riders are missing such a module before you confirm. Manage the modules on **Platform → Training modules**.

## Concurrent order cap (default: 2, allowed 1–10)

The most deliveries one rider can hold at once (assigned, accepted or picked up). It applies to pool claims, batch add-ons and restaurant assignments. Lowering it never takes orders away from a rider: they simply can't take new ones until they are under the limit.

## Rider earnings goals (defaults: ₹1,500 a day, ₹9,000 a week)

The daily and weekly targets shown as progress bars on the rider app's **Earnings** tab. They are motivation only and don't change pay, incentives or payouts. The daily goal can be up to ₹1,00,000 and the weekly goal up to ₹10,00,000.

## Dispatch timing (JIT invitations)

Whether riders are invited before the food is ready, and the buffer, speed and range used to time it, are set on **Platform → Dispatch insights**, next to the dispatch numbers they affect. The rider settings page links there.

