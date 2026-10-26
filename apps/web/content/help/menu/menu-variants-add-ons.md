---
title: Add sizes, variants and add-ons to an item
summary: Offer Half/Full or Small/Large sizes with their own prices, and add-on groups like Extra cheese with minimum and maximum choices.
audience: RESTAURANT_ADMIN
appArea: admin.menu
tags: variants, sizes, add-ons, modifiers, half, full, extra cheese
related: menu-items-manage, menu-item-availability, menu-bulk-import-export
language: en
---
## What it is

**Variants** are sizes or versions of one dish, such as Half and Full. **Add-on groups** are optional or required extras, such as "Add-ons" with an "Extra cheese" option.

## Where to find it

Save the item first. Then open it with the pencil (**Edit**) and expand **Variants & add-ons** at the bottom of the dialog. The header shows a short summary, or "None yet".

## Add sizes / variants

1. Under **Sizes / variants**, enter a **Name** (for example "Full") and a **Price (₹)**, then add it.
2. Repeat for each size. **Suggest sizes** proposes common sizes based on the item name, when it recognises one.
3. On each variant, use **Default** to choose the size picked when the customer does not choose, and **Available** to switch a size off.

A variant's price **replaces** the item's base price – it is the full price for that size, not an extra charge. With no variants, the item simply uses its base price.

## Add add-on groups

1. Under **Add-on groups**, enter a **New group name** (for example "Add-ons") and add it.
2. Set **Min** and **Max** to control how many options a customer must or may choose, and turn on **Required** if a choice is mandatory.
3. Add options with an **Option** name and a **+ Price (₹)**. Use 0 for free options.
4. Use each option's **Available** switch to hide it temporarily.

An option's price is **added** to the selected size (or base) price.

## Good to know

- Prices are always recalculated on the server at checkout, and selections that break your Min/Max rules are rejected.
- Menu import does not create variants or add-ons. Add them in the item editor after importing. See [Bulk import and export](help:menu-bulk-import-export).
