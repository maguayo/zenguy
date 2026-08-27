---
title: "How to monitor login and onboarding"
description: "SaaS dies in the first session: login loops, dead OAuth, an onboarding step that never finishes. Watch it with a staging user and a stop rule."
pubDate: 2026-08-13
category: guide
tags:
  - saas
  - login
  - onboarding
related:
  - how-to-monitor-a-checkout-flow
  - browser-tests-in-plain-english
  - why-http-200-is-not-enough
  - ci-passed-production-broke
image: /articles/monitor-login-and-onboarding.jpg
imageAlt: "A brass key and a leather card case beside a laptop on a night desk."
---

For a shop, the money path is checkout. For a SaaS, it is **sign in and the first successful action** — create a project, invite a teammate, see a dashboard that is not an error.

Those paths hide behind identity providers. Uptime on `app.yoursite.com/login` is a 200 on a form. It does not prove anyone got in.

## Use a dedicated user

Create `zenguy-watch@yourdomain.com` (or a staging tenant) with a password stored as a workspace secret. Allow-list:

- your app origin;
- your IdP (Google, GitHub, Auth0, Clerk, WorkOS…);
- any app subdomain the session lands on.

Do not use a founder's account. Do not use production admin. The agent will type the secret only on those hosts, and never show it again.

## Login test

> Open the app. Sign in with {{WATCH_EMAIL}} and {{WATCH_PASSWORD}}. After login, the page should show the heading “Overview” (or your real heading) and should not show “Invalid credentials” or a 2FA prompt. Do not change settings. Do not invite anyone.

If you use SSO only, the instructions should say which button to use and what the IdP page should look like. Put the IdP test user in the same secret store.

Interval: every 1–3 hours is plenty. Login is usually not the 30-second kind of failure; it is a config change at 18:00 that nobody notices until morning.

## Onboarding test

A second test, not a longer first one:

> Sign in as the watch user. If a “create workspace” screen appears, stop and fail — the watch user should already be provisioned. Open the first getting-started checklist item and confirm the empty state has a clear call to action. Do not delete data.

Or, on a sandbox tenant that *is* allowed to create objects:

> Create a sample project named “zenguy-watch”. Confirm it appears in the list. Do not start a paid plan. Do not delete other projects.

Be explicit about create vs delete. Zenguy avoids irreversible actions unless you insist.

## OAuth is why the agent leaves your domain

Login tests that cannot follow redirects to `accounts.google.com` are toys. Zenguy allows that navigation; the secret allow-list is what keeps the password off a surprise host.

If a new OAuth callback domain appears, add it to the list on purpose. Do not widen it to `*`.

## Pair with pings

HTTP monitors on `/login` and `/health` catch origin death. The browser test catches “the form is there and the session never starts”.

## Alerts

Same policy as checkout: retries first, one incident, recovery on. Route to the engineer who owns auth, not to a general marketing channel. A login outage is not a blog outage.

The first time you run this, watch the screenshots. If you see a real customer's name, you used the wrong account. Rotate the secret and start again.
