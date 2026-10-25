---
title: Order statuses explained
summary: What every order status means, from Payment Pending and Received through Preparing, Ready and Delivered, plus cancellation and refund states.
audience: RESTAURANT_ADMIN, KITCHEN
appArea: admin.orders
tags: order status, lifecycle, received, accepted, preparing, ready, delivered, cancelled, refund
related: restaurant-accept-orders, kitchen-board, restaurant-dedicated-riders
language: en
---
## What it is

Every order moves through a fixed set of statuses. Flavrly only allows moves that make sense (for example, an order cannot jump from Received straight to Delivered), and each change is recorded on the order's **Status timeline**.

## Payment

- **Payment Pending** – an online-payment order is waiting for the payment to complete.
- **Payment Failed** – the payment provider rejected it.

Cash on delivery and wallet orders skip this step and arrive as Received.

## Restaurant steps

- **Received** – a new order waiting for you to accept it.
- **Accepted** – you have confirmed it.
- **Preparing** – the kitchen is cooking it.
- **Ready** (Ready for Pickup) – the food is packed. For delivery orders this is when riders are notified.

## Rider steps (delivery orders)

**Rider Assigned**, **Rider Reached Restaurant**, **Picked Up**, **Out for Delivery** and **Rider Reached Customer**, then **Delivered**. When a delivery order goes Out for Delivery, the customer gets their delivery OTP by SMS.

## Delivery problems

- **Delivery OTP Failed** – the OTP was entered wrongly too many times.
- **Customer Unreachable** – the rider could not contact the customer.
- **Delivery Failed** – the order could not be handed over.

## Cancellations and refunds

- **Cancelled by Customer**, **Cancelled by Restaurant**, **Cancelled by Admin**, and the older plain **Cancelled**. On the Orders board, **Reject** on a Received order cancels it.
- **Refund Pending**, **Refund Initiated** and **Refunded** track money going back to the customer.

## Good to know

- Pickup and dine-in orders never need a rider; they go from Ready to Delivered.
- Customers get an SMS when the status changes, if they have a phone number on file.
- When an order is Delivered, the customer earns loyalty points and is asked for feedback.
