# Twilio production status

Last updated: 2026-08-26

This document contains resource identifiers and operational state only. It must
never contain the Twilio Auth Token or other secret values.

## Release scope

The current notification release scope is outbound SMS and outbound voice.
WhatsApp remains intentionally disabled. Stripe billing is implemented but
remains fail-closed until its complete environment-specific secret and catalog
group is installed.

Inbound SMS and voice webhooks are not configured because Zenguy currently has
no inbound SMS or voice product routes.

## Twilio inventory

- Account: `My First Twilio Account`
- Number: `+1 (850) 493-6489`
- Vanity representation: `+1 (850) 4-ZENGUY`
- Phone-number SID: `PNd9d0af623203225970bbb8f56c34bcdf`
- SMS source: `+18504936489`
- Voice source: `+18504936489`
- Primary compliance profile: approved
- Messaging Service: `MG34b6273f3161495ca8d2473b279ecc15`
- A2P Brand: `BN7b42b10ef4eeae3608cdf503f736a8f2`
- A2P Brand status: approved; identity verified; TCR identifier present
- Primary Customer Profile: `BUe35a515c21f82f854f6beb8167a6d415`
- A2P Trust Product: `BUaf89eae97ef28702167e360e3537e1ff`
- Messaging Service A2P status: not registered; no campaigns exist

SMS and calls display the `+1 (850) 493-6489` number. `ZENGUY` is the vanity
spelling of its digits, not an alphanumeric sender name or guaranteed caller
name.

The local ignored file `TWILIO_TOKENS.md` holds the production credentials for
transfer to 1Password. It must not be committed.

The four required SMS/voice secrets were installed in the production Worker on
2026-08-21. The production encryption key was also replaced with a valid
32-byte key after a read-only audit confirmed that the production D1 database
contained no encrypted records. `TWILIO_FROM_WHATSAPP` remains unset. The
Stripe production secret and catalog group is tracked separately and must be
installed atomically before paid checkout is enabled.

## Production deployment

- Release commit: `0dcadb7` (`Enable Twilio SMS and voice production release`)
- GitHub production workflow: `32523049985`, completed successfully
- Worker tests, migrations `0001` through `0017`, and deployment: successful
- `https://app.zenguy.com/api/health`: HTTP 200, `{"data":{"ok":true}}`
- `https://api.zenguy.com/api/health`: HTTP 200, `{"data":{"ok":true}}`
- Public privacy policy: <https://app.zenguy.com/privacy/>, HTTP 200
- Public terms: <https://app.zenguy.com/terms/>, HTTP 200
- Privacy contact: `privacy@zenguy.com`, routed to the verified production
  mailbox through Cloudflare Email Routing
- SMS geographic permission for Spain (`+34`): enabled
- Voice dialing permission for Spain: low-risk numbers enabled; high-risk
  special and toll-fraud ranges disabled

The deployed notification form requires an unchecked, explicit SMS-consent
checkbox. The API rejects SMS channel creation unless `consent: true` is sent.
Every outbound Zenguy SMS includes `Reply STOP to opt out; HELP for help.`
WhatsApp is not offered when creating a new notification channel.

## SMS release gate still open

Twilio A2P 10DLC brand registration is complete, but the campaign is not
submitted. In the campaign wizard, selecting a new low-volume campaign and
continuing returned `Error Setting Up A2P Campaign Registration — unexpected
error` on two attempts. The unsaved draft was discarded and no campaign charge
was accepted.

A read-only API audit confirmed that the Brand is genuinely approved and
verified, the existing number is attached to the Messaging Service, the
`LOW_VOLUME` use case is available, and there is no hidden or partial Campaign.
The Console failure is therefore not a Brand-approval failure.

Consequences:

- The application, Worker secrets, consent flow, legal pages, Messaging Service,
  and Twilio number are ready for SMS.
- Application-to-person SMS from this US long-code number to US recipients must
  not be considered production-ready until a campaign is submitted and approved.
- Twilio's current official pricing is USD 15 for campaign vetting plus USD 1.50
  per month for a low-volume mixed campaign, in addition to per-message and
  carrier fees. A rejected submission can incur another vetting fee when
  resubmitted.
- No real SMS has been sent from Zenguy yet.

Resume steps:

1. Obtain action-time approval for the USD 15 vetting charge and USD 1.50/month
   recurring fee.
2. Submit the prepared `LOW_VOLUME` campaign through Twilio's documented API;
   this is the fallback because the Console wizard errors before showing the
   form.
3. Record the returned Campaign SID and status without storing credentials in
   this document.
4. Wait for carrier approval. Campaign review is asynchronous and approval is
   not guaranteed.
5. Confirm that the approved Campaign, Messaging Service, and existing number
   are associated.
6. Send one explicitly approved SMS test and retain its Twilio message SID and
   final delivery status.

Twilio references:

- [Direct Standard onboarding](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/direct-standard-onboarding)
- [Campaign registration guide](https://help.twilio.com/hc/en-us/articles/1260803965530-A2P-10DLC-Campaign-Registration-Guide)
- [A2P 10DLC registration API](https://www.twilio.com/docs/messaging/api/usapptoperson-resource)

## Pricing and prepaid credit

Since 2026-08-22 SMS, voice and WhatsApp alerts are pay-as-you-go: each alert
is charged from a prepaid per-workspace credit at a per-destination price
derived from Twilio's rates for this US number (×2 markup, €0.05/€0.20
minimums, flat rest-of-world rate). Calls carry `TimeLimit=55` so one alert is
always a single billed minute, and SMS bodies are trimmed to one segment. See
`docs/alerts-paid-channels.md` for the table, the refresh procedure, and the
Stripe price needed to open top-ups.

## Voice status

The purchased number is the configured outbound caller ID. Zenguy creates an
outbound Twilio call with inline TwiML that reads the notification text aloud,
so no inbound voice webhook is required for the current feature.

The code and production secrets are deployed. Spain is enabled for low-risk
voice destinations, while high-risk special and toll-fraud ranges remain
blocked. No real voice call has been placed from Zenguy yet. Before declaring
the channel live, make one explicitly approved test call and confirm the Twilio
call's final status.

## WhatsApp checkpoint — intentionally parked

No Twilio WhatsApp Sender was created or approved, and the Twilio number is not
linked to WhatsApp.

Resources created during onboarding:

- Meta Business Portfolio: `1061287646487863`
- Meta WhatsApp Business Account: `1377134077295959` (`Zenguy`)
- Meta Business Support:
  <https://business.facebook.com/business-support-home/1061287646487863/1377134077295959/>

Meta restricted the WhatsApp Business Account immediately on 2026-08-21. The
onboarding error was `#2655121`: the account is restricted and cannot continue.
Business Support showed `Account Restricted`, with no visible review button,
and stated that the account could neither start/respond to conversations nor add
phone numbers.

Resume steps:

1. Resolve the restriction through Meta Business Support/review, or use another
   eligible and verified Business Portfolio/WABA owned by Zenguy.
2. Restart the Twilio WhatsApp Sender onboarding flow.
3. Register `+1 (850) 493-6489` only after Meta permits adding phone numbers.
4. Complete display-name review and wait until Twilio marks the sender approved.
5. Only then install `TWILIO_FROM_WHATSAPP=+18504936489` in production and
   re-enable the channel.
6. Send one explicitly approved WhatsApp test and record the provider SID and
   delivery status.

Until all of those steps are complete, `TWILIO_FROM_WHATSAPP` stays unset and
Zenguy rejects WhatsApp delivery attempts explicitly.
