---
title: "How to monitor a Shopify store"
description: "Shopify stores fail on themes, apps, and hosted checkout — not on your health endpoint. Watch the path across domains, in English."
pubDate: 2026-08-18
category: guide
tags:
  - shopify
  - ecommerce
  - checkout
related:
  - how-to-monitor-a-checkout-flow
  - best-tools-to-monitor-checkout
  - why-http-200-is-not-enough
  - how-to-get-alerted-when-checkout-breaks
image: /articles/how-to-monitor-a-shopify-store.jpg
imageAlt: "Folded t-shirt and a mailer on a night desk beside a laptop."
---

A Shopify store is several systems glued together: the theme on your domain, apps injecting scripts, and **checkout on Shopify's domain**. Uptime on the homepage does not watch the glue.

Zenguy is a fit here because the agent is allowed to leave the start URL. That is not a side effect. It is how Shopify, Shop Pay, and many apps work.

## What actually breaks

- A theme edit hides add-to-cart on mobile.
- An app for upsells throws and the drawer never opens.
- A price / inventory app serves zeros.
- Checkout loads, but a shipping rate never returns.
- A pixel or consent banner blocks the pay button.
- Shop Pay or a wallet button is a blank iframe.

CI on your theme repo will not see most of that. A 200 on `yourshop.com` will not either.

## The tests worth having

### Storefront happy path

> Open the shop. Confirm the catalog shows products. Open a product that is in stock. Check it has a price greater than 0. Add it to the cart. Check the cart has 1 item and a total greater than 0. Do not check out yet.

Run this hourly on desktop. Clone on mobile if you sell on phones.

### Checkout as far as you may go

Use Shopify's **Bogus Gateway** or a development store. Then:

> From the cart, go to checkout. Fill the required shipping fields with test data. Check that an order summary is visible and the total is greater than 0. Do not submit payment.

Name the stop twice if you are nervous. Store any customer email or password as secrets, allow-listed to your shop domain and `checkout.shopify.com` (and Shop Pay if you use it).

### Password-protected storefronts

If the shop is behind a storefront password, put that password in a secret and say so in the instructions. Do not paste it in the test body.

## HTTP monitors on the side

Point unlimited Zenguy uptime monitors at:

- `https://yourshop.com`
- the checkout host if you want origin death separate from theme death
- any custom app proxy you rely on

Five minutes is enough. Shopify's own status page covers *their* global incidents; it will not cover *your* theme.

## Apps and third parties

Every app is a new way to break add-to-cart. After installing or updating an app, run the storefront test once (`Run now`) before you go home. That is cheaper than a weekend of empty carts.

## What not to do

- Do not complete real purchases on the live gateway.
- Do not scrape production customer data into a test.
- Do not assert on exact app-widget copy that marketing changes weekly. Assert on **price, cart count, and a visible checkout**.

A Shopify-specific monitoring stack is still just: pings for death, a browser walk for money. The walk has to be allowed to change domain. Zenguy is built that way on purpose.
