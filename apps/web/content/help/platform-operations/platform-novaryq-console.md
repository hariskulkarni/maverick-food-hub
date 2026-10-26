---
title: Platform team: Novaryq POS integration console (super admin)
summary: For Flavrly super admins. Set up, switch on and monitor the Novaryq POS integration for any restaurant from Platform → Novaryq POS.
audience: ALL
appArea: platform.novaryq
tags: super admin, platform, novaryq, pos, integration, kitchen, menu sync, webhook, replay
related: novaryq-pos-integration
language: en
---
## What it is

**Platform → Novaryq POS** lists every restaurant on Flavrly with its Novaryq integration state, health, linked branches and items, orders sent and the last update received from Novaryq. From here you can set up and manage the integration for any restaurant. Restaurant admins see and can change the same settings under **Admin > POS integration**.

## The platform switch

The integration only does anything while the platform switch `NOVARYQ_INTEGRATION_ENABLED` is on in the server environment. While it is off, Flavrly and Novaryq run independently: no orders are sent, no updates are applied, and settings cannot be changed. The banner at the top of the console shows the current state.

## Set up a restaurant

1. Find the restaurant (search by name or slug, or use **Not set up**) and tap **Set up**.
2. Enter the restaurant's Novaryq India URL, API key and secret, turn on **Send new Flavrly orders to Novaryq** and tap **Test & save**. Only Novaryq India (INR) accounts connect.
3. Give the restaurant the **webhook URL** and the **Flavrly restaurant page** link to add in their Novaryq admin, then paste the webhook signing secret they get back.
4. Link each branch to its Novaryq location, then **Import Novaryq menu** or **Auto-match by name**.
5. Optionally turn on **POS: Novaryq** so Novaryq becomes the menu master for linked items.

## Watch and fix

- **Needs attention** shows restaurants with failed or retrying syncs or a broken connection.
- Open a restaurant to read its sync log and **Replay** failed or given-up orders once the cause is fixed.
- Orders voided in Novaryq after pickup appear on **Live ops** as "Voided in POS (Novaryq)".

## Good to know

- Every change you make here is recorded in the audit log under your account.
- Turning a restaurant's integration off stops all syncing for that restaurant straight away; queued orders stay and can be replayed later.
- Restaurant guide: [Connect your Novaryq POS](help:novaryq-pos-integration).
