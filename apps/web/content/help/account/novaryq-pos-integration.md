---
title: Connect your Novaryq POS
summary: Send every Flavrly order to your Novaryq POS kitchen, follow kitchen progress back on Flavrly, and keep sold-out (86'd) items in sync. Set up under Admin > POS integration.
audience: RESTAURANT_ADMIN
appArea: admin.integrations
tags: novaryq, pos, integration, kitchen ticket, kot, 86, sold out, sync, webhook
related: restaurant-order-statuses, menu-item-availability, restaurant-accept-orders
language: en
---
## What it does

When your restaurant uses **Novaryq POS**, Flavrly can work with it directly:

- **Orders go to your POS.** Every Flavrly order that is received (cash on delivery, or paid online) appears in Novaryq as an order and kitchen ticket, at Flavrly's prices, marked as prepaid or cash to collect. An order is never sent twice.
- **Kitchen progress comes back.** When the kitchen marks the order in prep or ready in Novaryq, the Flavrly order moves too. If an order is cancelled on Flavrly, it is cancelled in Novaryq.
- **Sold-out items stay in sync.** Marking an item out of stock (86) in Novaryq makes it unavailable on Flavrly within seconds.

Flavrly orders never wait for the POS. If Novaryq is down, orders still come in on Flavrly and are sent to the POS when it is back.

## Before you start

You need a restaurant admin login on Flavrly and access to **Developer** in your Novaryq back office. Flavrly connects only to **Novaryq India** accounts: your Novaryq account and locations must sell in Indian rupees (INR). A North America account (USD or CAD) is refused.

## Set it up

1. In Novaryq, open **Developer > API keys** and create a key with the scopes **read:menu**, **read:orders** and **write:orders**. Copy the key and the secret.
2. On Flavrly, open **Admin > POS integration**. Enter your Novaryq URL, the API key and the API secret, turn on **Send new Flavrly orders to Novaryq**, and tap **Test & save**.
3. Copy the **webhook URL** shown on the page. In Novaryq, open **Developer > Webhooks**, add that URL and tick the events listed on the page.
4. Copy the signing secret Novaryq shows (it starts with whsec_) into **Webhook signing secret** on Flavrly and save again. Press **Send test** in Novaryq; the time appears under "Last webhook received".
5. Under **Branches → Novaryq locations**, enter the Novaryq location id for each branch and tap **Save**.
6. Link your menu: tap **Import Novaryq menu** to copy the Novaryq menu into the branch, or use **Auto-match by name** and pick the Novaryq item for anything left over.

## Make Novaryq your menu master ("POS: Novaryq")

Once your branches and menu are linked, turn on **POS: Novaryq** under **Admin > POS integration**:

- The names, prices and availability of linked items come from Novaryq and are read-only on Flavrly. Change them in Novaryq; Flavrly follows automatically (sold-out within seconds, everything else at the next sync or import).
- You can still add photos, descriptions, sizes and add-ons on Flavrly, and keep Flavrly-only items.
- Spreadsheet and template menu imports are switched off; use **Import Novaryq menu** instead.
- **Flavrly-only prices** are off by default. Tick "Allow Flavrly-only prices" if you want a different online price for linked items; you then manage those prices on Flavrly.
- Copy **Your Flavrly restaurant page** from the same screen. In Novaryq, open **Admin > Integrations > Flavrly — online ordering & delivery (India)** and paste it there. Novaryq then sends your storefront and online-ordering visitors to Flavrly and turns off its own online ordering, kiosk ordering and in-house delivery dispatch for your restaurant; your POS, kitchen and table orders are unchanged.
- Novaryq accepts only an https link on flavrly.in, and only for Novaryq India accounts whose locations are all in India and use INR.

## Good to know

- An order containing an item that is not linked to a Novaryq item is not sent. It shows as **failed** in the sync log with the item names, and the admins get an e-mail. Link the items, then tap **Replay**.
- If Novaryq cannot be reached, Flavrly keeps retrying for several hours. After 8 tries the order shows as **gave up** and the admins get an e-mail; tap **Replay** once Novaryq is back.
- Kitchen progress follows the POS: when the kitchen marks the order ready in Novaryq, it becomes **Ready** on Flavrly (accepted and preparing on the way). If **Auto-accept orders** is on in Settings > Order flow, the order is accepted as soon as the ticket reaches the kitchen; otherwise it stays new until you accept it on Flavrly or the POS marks it ready.
- Flavrly riders deliver: delivery orders are marked in Novaryq as delivered by Flavrly, so do not send your own driver. For delivery orders the rider completes the order on Flavrly.
- If an order is voided in Novaryq after the rider has picked it up, Flavrly does not cancel it automatically. The platform team is alerted to decide.
- Your API secret and webhook secret are stored encrypted and are never shown again. To change one, type the new value; leave the box empty to keep the saved one.
- See [Order statuses](help:restaurant-order-statuses) and [Item availability](help:menu-item-availability).
