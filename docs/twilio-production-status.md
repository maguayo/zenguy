# Twilio production status

Last updated: 2026-08-21

This document contains resource identifiers and operational state only. It must
never contain the Twilio Auth Token or other secret values.

## Release scope

The current release scope is outbound SMS and outbound voice notifications.
WhatsApp and Paddle are intentionally disabled for now. The API treats both as
optional integrations and fails closed if a disabled channel or billing route is
used.

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
2026-08-21. `TWILIO_FROM_WHATSAPP` and every Paddle secret remain unset.

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

- The application and Twilio number can be configured for SMS now.
- Application-to-person SMS from this US long-code number to US recipients must
  not be considered production-ready until a campaign is submitted and approved.
- Twilio currently documents a campaign vetting fee and a monthly low-volume
  campaign fee. Confirm the live price in the Console immediately before the
  paid submission.
- No real SMS has been sent from Zenguy yet.

Resume steps:

1. Open Twilio Console > Messaging > Regulatory Compliance > A2P 10DLC.
2. Re-open campaign registration under the completed brand/profile.
3. Select the low-volume mixed use case (under 6,000 messages per day).
4. Publish public Privacy and Terms pages that satisfy Twilio's SMS disclosure
   requirements. At the time of this audit, `https://zenguy.com/privacy` and
   `https://zenguy.com/terms` return 404.
5. Add an explicit SMS-consent control to the Zenguy notification-channel form
   and enforce the consent flag in the API.
6. Complete the campaign description, sample messages, opt-in workflow, and
   opt-out/help wording using that actual Zenguy product behavior.
7. Review the live vetting and recurring fees and obtain action-time approval
   before submitting the charge.
8. Wait for carrier approval; then associate the approved campaign with the
   existing Messaging Service and number.
9. Send one explicitly approved SMS test and retain its Twilio message SID and
   delivery status.

Twilio references:

- [Direct Standard onboarding](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/direct-standard-onboarding)
- [Campaign registration guide](https://help.twilio.com/hc/en-us/articles/1260803965530-A2P-10DLC-Campaign-Registration-Guide)
- [A2P 10DLC registration API](https://www.twilio.com/docs/messaging/api/usapptoperson-resource)

## Voice status

The purchased number is the configured outbound caller ID. Zenguy creates an
outbound Twilio call with inline TwiML that reads the notification text aloud,
so no inbound voice webhook is required for the current feature.

No real voice call has been placed from Zenguy yet. Before declaring the channel
live, make one explicitly approved test call and confirm the Twilio call status.

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
