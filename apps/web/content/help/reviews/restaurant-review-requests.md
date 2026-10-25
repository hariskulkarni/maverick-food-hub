---
title: Ask customers for Google reviews after their order
summary: Send every customer one message after delivery or pickup asking how their order was, with a link to review you on Google. Covers channels, timing, quiet hours, reminders, opt-outs and the rules you must follow.
audience: RESTAURANT_ADMIN
appArea: admin.settings
tags: review requests, google reviews, ask for reviews, opt-out, unsubscribe, sms, whatsapp, email, compliance
related: restaurant-review-qr-kit, restaurant-service-recovery, restaurant-google-reviews-setup
language: en
---
## What it is

**Review requests** sends each customer one short message after their order is delivered or picked up: "How was your order?", with a link to rate it. The page they land on also has a **Review us on Google** button. Turn it on in **Settings > Reviews > Review requests**. It is off until you switch it on.

## The rules (please read)

Google and consumer law don't allow "review gating" or paying for reviews. Flavrly is built to keep you on the right side of both:

- **Every customer gets the same request**, and the Google button is shown at every rating – before and after they rate. Unhappy customers are never filtered away from Google.
- **Never offer discounts, freebies or rewards for reviews**, and never ask staff to hit review targets. Messages contain no offers or promo text.
- **Customers can opt out** from any message.

## Set it up

1. Make sure Flavrly has your Google review link. It comes from your Google Business Profile or Quick connect listing, or paste one under **Manual review link (overrides the above)**. With Business Profile connected you can tap **Use my Google Business Profile location**. Without a link, customers can still rate their order – they just don't see the Google button.
2. Switch on **Review requests** and choose **Channels**. The first channel the customer can be reached on is used, in the order SMS → WhatsApp → Email.
3. Set **Send after delivery / pickup (minutes)** (default 60) and **Ask a customer at most once every (days)** (default 30; 0 means no limit).
4. Keep **Quiet hours (IST)** on to hold asks overnight (default 9 PM to 9 AM). Held asks go out in the morning.
5. Optionally turn on **Send one reminder if the link wasn't opened** and set **Reminder after (hours)** (default 24). The reminder only goes out if the customer hasn't opened the link or given feedback.
6. Set **Open a service-recovery ticket at or below** (default 3 stars). See [Follow up on low ratings](help:restaurant-service-recovery).
7. Tap **Save**.

## WhatsApp

WhatsApp needs WhatsApp Cloud API credentials (**Settings > Integrations**) and an approved Utility template. Enter the **WhatsApp template name** and **Template language**. Until both are set up, the next channel is used instead.

## Who doesn't get an ask

A customer is skipped if they already left feedback, opted out, were asked within your frequency limit, or can't be reached on any channel you chose. An ask that is more than 72 hours late (for example, if sending was paused) is dropped rather than sent late. Each order gets at most one ask, and a failed send is not retried.

## Opting out

Every message has a stop link. It opens **Stop review requests**, where the customer chooses **Stop requests from** your restaurant or **Stop requests from all restaurants**. Order updates are not affected. Opting out also cancels any scheduled ask or reminder.

## Results

The card shows the last 30 days: **Asks sent**, **Link clicks**, **Feedback**, **Google clicks**, **Opt-outs** and **QR scans**.

## Good to know

- When review requests are on, they replace the older "rate your order" text message, so customers aren't asked twice.
- For dine-in guests and delivery bags, print the [review QR kit](help:restaurant-review-qr-kit).
