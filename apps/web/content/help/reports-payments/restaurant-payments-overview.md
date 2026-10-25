---
title: How payments and settlements work
summary: Online payments, cash on delivery and wallet orders, where to connect a payment gateway, and how your settlement for delivered orders is calculated.
audience: RESTAURANT_ADMIN
appArea: admin.reports
tags: payments, cod, online payment, razorpay, phonepe, settlement, commission, payout
related: restaurant-sales-reports, restaurant-order-statuses, restaurant-accept-orders
language: en
---
## Payment methods

Customers can pay in these ways:

- **Online** through Razorpay or PhonePe. The order starts as **Payment Pending** and reaches you as **Received** once the payment completes. If the provider rejects it, the order becomes **Payment Failed**.
- **Cash on delivery (COD)** and **wallet** orders arrive as **Received** straight away.

## Connecting a payment gateway

Payment gateways are set up in **Settings > Integrations** (Razorpay payments or PhonePe payments) using a guided wizard. Secrets are stored encrypted. If your restaurant is part of a group, a child restaurant can use the parent's gateway without connecting its own.

## Seeing your payments

- **Dashboard > Payment mix (today)**.
- The **COD** and **Online paid** filters on **Admin > Orders**.
- The **Payment mode** report in **Admin > Reports**, with count and total per method.

## How settlement is calculated

The platform team prepares settlement reports for each period. For each **delivered** order:

- **Net order value** = item subtotal + packaging + delivery fee − promo discount − sign-up bonus discount + GST collected.
- **Commission** = (subtotal − discounts) × your commission rate.
- A **payment fee** applies to online orders only, not COD.
- **GST on fees** (18% of commission plus payment fee), **TCS** (1%) and **TDS** (1%) are deducted.
- **Payout** = net order value − deductions + any additions.

Cancelled and failed orders carry no settlement value.

## Good to know

- Your commission and payment fee rates are set per restaurant by the platform team. The tax rates above are defaults and can be configured; they are not tax advice – confirm with your accountant.
- Payout timing is not shown in the restaurant admin. Contact platform support for settlement questions.
- Refunds follow the statuses **Refund Pending**, **Refund Initiated** and **Refunded**. See [Order statuses](help:restaurant-order-statuses).
