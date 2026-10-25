---
title: Connect Google reviews and set up auto-reply
summary: Link your Google Business Profile or use Quick connect, choose an AI model for reply drafts, set auto-reply rules, and control publishing of in-app reviews.
audience: RESTAURANT_ADMIN
appArea: admin.settings
tags: google business profile, google places, auto-reply, ai model, reviews settings, auto-publish
related: restaurant-google-reviews, restaurant-customer-feedback
language: en
---
## What it is

All review settings live in **Settings > Reviews**. They control where Google reviews come from, how AI drafts replies, and whether your own customers' reviews go live automatically.

## Auto-publish customer reviews

This switch is about reviews left in Flavrly by your customers. When on, new reviews go live immediately. When off, they stay hidden until you publish them from **Admin > Feedback**. See [Customer feedback](help:restaurant-customer-feedback).

## Connect Google

You have two options:

- **Google Business Profile** – tap **Connect Google Business** and sign in with the Google account that manages your listing. If that account has several locations, pick yours and tap **Use this location**. This lets you post replies from Flavrly. Use **Reconnect Google** or **Disconnect** to change it later.
- **Quick connect (Google Places)** – search for your restaurant by name and area, tap **Search**, and choose your listing. It shows your latest Google reviews straight away, but replies must be posted on Google itself. If you see "Quick connect is not enabled on this server yet", this option isn't available.

## AI reply model

Under **AI reply model**, choose a **Provider** (Anthropic, OpenAI or NVIDIA), paste your **API key**, optionally set a **Model**, and tap **Test & save**.

## Auto-reply rules

Turn on **Auto-reply**, then set two star thresholds:

- **Auto-post at or above** – these reviews get a reply posted automatically.
- **Draft for approval at or below** – these get a draft waiting in your Draft inbox.

The draft threshold must be lower than the auto-post threshold. Reviews rated in between get no automatic reply. Add optional **Tone instructions** (for example "Warm, brief, sign off with the owner's name") and tap **Save**.

## Good to know

- Auto-reply works only with a Google Business Profile connection, and only for reviews written after you turned auto-reply on.
- An AI reply model must be saved for drafts and auto-replies to be generated.
- See [Read and reply to Google reviews](help:restaurant-google-reviews) for the day-to-day workflow.
