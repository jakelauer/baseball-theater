<!-- Written 2026-11-28 for S256 (which took in S257): which payment provider BT would move to from Patreon. Drafted before the owner chose a support model (docs/v3/SUPPORT-MODEL.md); the By support model section, the recommendation and the provider question are settled only after that answer. -->

# Which payment provider BT would move to from Patreon

Researched 2026-11-28 for S256. This is research, not financial, tax or legal advice. Prices change often, so recheck each one on its vendor's page before committing; every figure below names the page it came from and the day it was read, and a figure not on a vendor's page is marked as an estimate with why. Nothing here is fetched by code: the pages were read by hand once.

The owner asked for this comparison in these words: *"Compare the cut taken by patron to the ones that do the tax work for you"* (2026-11-28), after *"Actually... if it makes no difference that Patreon acts like a donation then I probably want to phase out Patreon in favor of Link, Stripe, or similar"* (same day).

## Summary

- **Patreon** (the baseline) takes a platform fee on top of card processing and handles sales tax and VAT on memberships itself. Its pricing page could not be read on 2026-11-28 (it answered every request with a bot check), so its row is the agent's estimate, to be checked; BT's plan is the owner's to name.
- **Plain Stripe** (Billing for subscriptions, Stripe Tax to calculate tax) is, on a US card, the cheapest per payment at every price point but one (Patreon's legacy Lite plan, estimated, is a cent less at monthly $3); on an EU card, Paddle is cheaper on every annual price (by 2¢, 16¢ and 52¢ at $36, $60 and $120) and Lite at monthly $3. But BT is the merchant of record: it registers for, collects and files sales tax and VAT itself, and owes EU VAT from its first sale to an EU consumer.
- **Merchant-of-record services** (Paddle, Polar, Stripe Managed Payments) sell on BT's behalf and handle that tax, for a larger cut. Paddle's and Polar's 50¢ fixed fee is most of their cut at $3 and $5 and 43–50% of it at $10, so annual billing cuts their share most at the low prices (Paddle: 21.7% at monthly $3 to 6.4% at annual $36; 10.0% to 5.4% at $10). Stripe Managed Payments' cut leans more on its percentage (7.1% + 30¢ on a US-card subscription), so annual billing saves it less (US card: 17.1% to 7.9% at $3; 10.1% to 7.4% at $10).
- **Link** is Stripe's saved-payment checkout, not a provider of its own; **Lemon Squeezy** now sells through Link, LLC, takes no new sign-ups and shuts down on March 31, 2027, pointing sellers to Stripe Managed Payments.

## Fees

What a supporter's payment costs BT, in US dollars, as the fee and as a share of the payment, for a US card and an EU card. Assumptions: BT charges in US dollars, so no provider converts currency (an EU card's bank converts, at the supporter's cost); tax is added on top of the price where it applies, so fees are shown on the price itself; one payment a period (a monthly $5 is twelve payments a year, an annual $60 one). Fees are rounded to the cent and shares to a tenth of a per cent, both half up from the unrounded fee. Patreon's rows are one per plan: BT's plan is not recorded anywhere in the repository, so it is asked of the owner separately, at the same pause as SUPPORT-MODEL's question, and recorded on the story's own `**Owner answer (Patreon plan):**` line.

| Candidate | Card | One-off $3 | One-off $5 | One-off $10 | Monthly $3 | Monthly $5 | Monthly $10 | Annual $36 | Annual $60 | Annual $120 | Source | Read |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Patreon, current pricing (10%) | US | n/a | n/a | n/a | $0.55 (18.3%) | $0.95 (18.9%) | $1.59 (15.9%) | $4.94 (13.7%) | $8.04 (13.4%) | $15.78 (13.2%) | https://www.patreon.com/pricing | Estimate: the page answered with a bot check when tried on 2026-11-28; figures from the agent's knowledge, to be checked |
| Patreon, current pricing (10%) | EU | n/a | n/a | n/a | $0.55 (18.3%) | $0.95 (18.9%) | $1.59 (15.9%) | $4.94 (13.7%) | $8.04 (13.4%) | $15.78 (13.2%) | https://www.patreon.com/pricing | Estimate, as above (2026-11-28); a currency conversion fee may apply, not counted |
| Patreon, Lite (legacy, 5%) | US | n/a | n/a | n/a | $0.40 (13.3%) | $0.70 (13.9%) | $1.09 (10.9%) | $3.14 (8.7%) | $5.04 (8.4%) | $9.78 (8.2%) | https://www.patreon.com/pricing | Estimate, as above (2026-11-28) |
| Patreon, Lite (legacy, 5%) | EU | n/a | n/a | n/a | $0.40 (13.3%) | $0.70 (13.9%) | $1.09 (10.9%) | $3.14 (8.7%) | $5.04 (8.4%) | $9.78 (8.2%) | https://www.patreon.com/pricing | Estimate, as above (2026-11-28) |
| Patreon, Pro (legacy, 8%) | US | n/a | n/a | n/a | $0.49 (16.3%) | $0.85 (16.9%) | $1.39 (13.9%) | $4.22 (11.7%) | $6.84 (11.4%) | $13.38 (11.2%) | https://www.patreon.com/pricing | Estimate, as above (2026-11-28) |
| Patreon, Pro (legacy, 8%) | EU | n/a | n/a | n/a | $0.49 (16.3%) | $0.85 (16.9%) | $1.39 (13.9%) | $4.22 (11.7%) | $6.84 (11.4%) | $13.38 (11.2%) | https://www.patreon.com/pricing | Estimate, as above (2026-11-28) |
| Patreon, Premium (legacy, 12%) | US | n/a | n/a | n/a | $0.61 (20.3%) | $1.05 (20.9%) | $1.79 (17.9%) | $5.66 (15.7%) | $9.24 (15.4%) | $18.18 (15.2%) | https://www.patreon.com/pricing | Estimate, as above (2026-11-28) |
| Patreon, Premium (legacy, 12%) | EU | n/a | n/a | n/a | $0.61 (20.3%) | $1.05 (20.9%) | $1.79 (17.9%) | $5.66 (15.7%) | $9.24 (15.4%) | $18.18 (15.2%) | https://www.patreon.com/pricing | Estimate, as above (2026-11-28) |
| Stripe Billing + Stripe Tax | US | $0.39 (12.9%) | $0.45 (8.9%) | $0.59 (5.9%) | $0.41 (13.6%) | $0.48 (9.6%) | $0.66 (6.6%) | $1.60 (4.4%) | $2.46 (4.1%) | $4.62 (3.9%) | https://stripe.com/pricing | 2026-11-28 |
| Stripe Billing + Stripe Tax | EU | $0.45 (14.9%) | $0.55 (10.9%) | $0.79 (7.9%) | $0.47 (15.6%) | $0.58 (11.6%) | $0.86 (8.6%) | $2.32 (6.4%) | $3.66 (6.1%) | $7.02 (5.9%) | https://stripe.com/pricing | 2026-11-28 |
| Stripe Managed Payments | US | $0.49 (16.4%) | $0.62 (12.4%) | $0.94 (9.4%) | $0.51 (17.1%) | $0.66 (13.1%) | $1.01 (10.1%) | $2.86 (7.9%) | $4.56 (7.6%) | $8.82 (7.4%) | https://stripe.com/pricing | 2026-11-28 |
| Stripe Managed Payments | EU | $0.54 (17.9%) | $0.70 (13.9%) | $1.09 (10.9%) | $0.56 (18.6%) | $0.73 (14.6%) | $1.16 (11.6%) | $3.40 (9.4%) | $5.46 (9.1%) | $10.62 (8.9%) | https://stripe.com/pricing | 2026-11-28 |
| Paddle | US | $0.65 (21.7%) | $0.75 (15.0%) | $1.00 (10.0%) | $0.65 (21.7%) | $0.75 (15.0%) | $1.00 (10.0%) | $2.30 (6.4%) | $3.50 (5.8%) | $6.50 (5.4%) | https://www.paddle.com/pricing | 2026-11-28 |
| Paddle | EU | $0.65 (21.7%) | $0.75 (15.0%) | $1.00 (10.0%) | $0.65 (21.7%) | $0.75 (15.0%) | $1.00 (10.0%) | $2.30 (6.4%) | $3.50 (5.8%) | $6.50 (5.4%) | https://www.paddle.com/pricing | 2026-11-28 |
| Polar (Starter) | US | $0.65 (21.7%) | $0.75 (15.0%) | $1.00 (10.0%) | $0.65 (21.7%) | $0.75 (15.0%) | $1.00 (10.0%) | $2.30 (6.4%) | $3.50 (5.8%) | $6.50 (5.4%) | https://polar.sh/resources/pricing | 2026-11-28 |
| Polar (Starter) | EU | $0.70 (23.2%) | $0.83 (16.5%) | $1.15 (11.5%) | $0.70 (23.2%) | $0.83 (16.5%) | $1.15 (11.5%) | $2.84 (7.9%) | $4.40 (7.3%) | $8.30 (6.9%) | https://polar.sh/resources/pricing | 2026-11-28 |

How each row is worked out:

- **Patreon** (estimate): its platform fee (10% for a page launched under current pricing; the legacy plans Lite 5%, Pro 8% and Premium 12%, as the agent recalls them), plus payment processing of 2.9% + $0.30 on a payment over $3 and 5% + $0.10 on $3 or less. Patreon is a membership: one-off tips are not a Patreon payment ("n/a"). Payout fees (by PayPal, Payoneer or bank transfer) and currency conversion are charged on top and are not counted. None of this could be read on Patreon's page on 2026-11-28, so every Patreon figure is to be checked; the owner's own Patreon creator dashboard shows the plan and the fees BT pays today.
- **Stripe Billing + Stripe Tax:** card processing "2.9% + 30¢" for a domestic card, "+ 1.5%" for an international card; Billing "0.7%" of Billing volume on subscriptions (one-off payments are not Billing volume); Stripe Tax "0.5%" per transaction for a no-code integration, or "$0.50" per transaction for an API integration, only where BT is registered to collect tax; the 0.5% is counted on the EU rows, since BT owes EU VAT from the first sale (Tax), and not on the US rows (no US state registration is needed until a state's threshold, an estimate of BT's sales). Which of the two Tax prices BT's Checkout integration pays is to be checked with Stripe: at $0.50 a payment, the EU $3 monthly row would cost about $0.95, not $0.47. Standard payouts are free. A dispute costs "$15.00".
- **Stripe Managed Payments:** "3.5%" per transaction on top of Payments fees, so card processing as above plus 3.5%. Subscriptions under Managed Payments are "Available with Billing", so Billing's 0.7% is counted on the monthly and annual columns (an estimate: the page doesn't say whether Billing is charged under Managed Payments).
- **Paddle:** "5% + 50¢ per Checkout transaction" on its pay-as-you-go plan, tax handling included; for products under $10 its page says to "contact us for bespoke pricing", so the $3, $5 and $10 columns may be lower by agreement. Currency conversion, chargeback and payout fees are not on the page.
- **Polar (Starter):** "5% + 50¢" per transaction, "+1.5% for international cards (non-US)", no separate subscription fee on Starter (Pro and higher plans cost less per transaction, from 3.8% + 40¢, for a monthly plan fee not modelled here). Payouts go through Stripe, which charges $2 a month of active payouts plus 0.25% + $0.25 a payout, not counted per payment; disputes "$15 per dispute, regardless of outcome".

## Link and Lemon Squeezy

- **Link** is not a payment provider of its own: link.com (read 2026-11-28) calls it "A smarter way to pay", "Built by Stripe", a consumer wallet that lets a shopper "autofill your payment details" at "more than a million businesses"; its only business link goes to Stripe (`stripe.com/payments/link`). A business gets Link by using Stripe's checkout, and Stripe's pricing page (read 2026-11-28) lists no separate fee for it. So the owner's "Link" is Stripe's checkout, covered by the Stripe rows.
- **Lemon Squeezy** (https://www.lemonsqueezy.com/pricing, read 2026-11-28) still lists "5% + 50¢" per transaction, but its banner says it is "no longer accepting new sign-ups and will shut down on March 31, 2027", its footer reads "Sold through Link, LLC f/k/a Lemon Squeezy LLC", and its button reads "Start with Managed Payments", pointing to Stripe. It is not a candidate; Stripe Managed Payments is where it went.

## Tax

The European Commission's own pages on the One-Stop Shop (https://vat-one-stop-shop.ec.europa.eu/index_en and https://vat-one-stop-shop.ec.europa.eu/one-stop-shop/register-oss_en, both read 2026-11-28) say: the non-Union scheme is for a taxable person not established in the EU who "supplies services to non-taxable persons taking place in the EU", registering in any one Member State it chooses and declaring all its EU consumer sales there; the EUR 10 000 threshold lets supplies of telecommunications, broadcasting and electronic services "remain subject to VAT in the Member State where the taxable person is established", which a seller outside the EU doesn't have, and the pages give no threshold for the non-Union scheme. So, on the agent's reading of those pages, a seller outside the EU owes EU VAT on a digital service from its first sale to an EU consumer, declared through the One-Stop Shop. US sales tax is set state by state, each with its own threshold of sales into the state (not read for this document).

### Patreon

**Seller of record:** Patreon sells the membership to the patron; the note found that Patreon itself collects sales tax on a membership's benefits. (Patreon's own pages could not be read on 2026-11-28, so this is the note's finding and the agent's understanding, to be checked.)

**US sales tax:** Collected and remitted by Patreon where a membership is taxable, as above (to be checked).

**EU VAT:** Collected and remitted by Patreon on EU patrons' memberships (to be checked).

**What BT does:** Report its Patreon payouts as income; nothing for sales tax or VAT.

### Stripe Billing and Stripe Tax

**Seller of record:** BT. Stripe processes the card; BT is the seller (Stripe's Managed Payments comparison table lists "Your business" as merchant of record for its other products, https://docs.stripe.com/payments/managed-payments, read 2026-11-28).

**US sales tax:** BT registers in each state once it passes that state's threshold, collects and files; Stripe Tax calculates the tax at checkout and reports what was collected, for 0.5% per transaction where BT is registered. Whether a supporter's membership is taxable depends on the state and on what it unlocks (SUPPORT-MODEL: a membership with perks is a purchase).

**EU VAT:** BT registers for the One-Stop Shop's non-Union scheme in one Member State before its first EU sale, charges each EU consumer their country's VAT rate, and files the quarterly OSS return and pays; Stripe Tax calculates the rate but does not file.

**What BT does:** Registers (OSS, and US states as thresholds are passed), keeps the records, files and pays every return, and answers any audit. This is the work the owner asked to compare against services that do it.

### Paddle

**Seller of record:** Paddle: its pricing page (https://www.paddle.com/pricing, read 2026-11-28) says it acts as BT's merchant of record.

**US sales tax:** Paddle collects, files and remits: its pricing page says it handles tax collection, filing deadlines and returns.

**EU VAT:** Paddle collects, files and remits, under its own registrations.

**What BT does:** Nothing for sales tax or VAT; reports Paddle's payouts as income. Whether Paddle accepts a tip with nothing unlocked, or a supporters' membership, as a product it sells is to be checked with Paddle (the agent's understanding is that merchant-of-record services sell products, not donations).

### Polar

**Seller of record:** Polar: its pricing page (https://polar.sh/resources/pricing, read 2026-11-28) names Polar the merchant of record.

**US sales tax:** Polar's paid plans include "international tax compliance"; its page does not say in so many words that Polar files US sales tax, so it is to be checked on Polar's docs.

**EU VAT:** Polar's example shows Swedish VAT included in a payment, so Polar charges EU VAT; filing is part of its "international tax compliance" (to be checked, as above).

**What BT does:** Nothing for sales tax or VAT, if Polar files as its page implies; reports Polar's payouts as income.

### Stripe Managed Payments

**Seller of record:** Stripe: the Managed Payments comparison table lists "Stripe" as merchant of record (https://docs.stripe.com/payments/managed-payments, read 2026-11-28).

**US sales tax:** Stripe handles "sales tax, VAT, and GST compliance in more than 80 countries" (same page).

**EU VAT:** Handled by Stripe, as above.

**What BT does:** Nothing for sales tax or VAT; assigns each product an eligible tax code. Eligibility is reviewed by Stripe: products must be "fully automated digital" products (https://docs.stripe.com/payments/managed-payments/eligibility, read 2026-11-28); a membership to BT's features fits a code such as "Website Information Services - Personal Use", but a tip with nothing unlocked is not a product and may not be eligible (to be checked with Stripe). US businesses are eligible.

## Running it

What each provider would mean for BT's servers and records. Under every provider BT applies a payment's event to the `entitlements` row only once and only if newer (ADR-022): none of these providers promises events in order, so the plan is the same for each: dedupe by the event's id, and on each event fetch the subscription's current state from the provider's API and write that, versioned by the provider's own updated time, so an older event arriving late can't undo a newer one. What BT keeps is labelled in the classification manifest (`functions/src/services/data-classification.ts`) under ADR-028's BT database: users row, as `entitlements` and `patreonUserId` are today.

### Patreon

**Support types:** Memberships, monthly or yearly; no one-off tip as a Patreon payment.

**Refunds and disputes:** Handled by Patreon (fees not read: its pages could not be read on 2026-11-28).

**Payouts:** Patreon pays out to PayPal, Payoneer or a bank, with a fee per payout by method (not read, to be checked).

**Customer portal:** Patreon's own membership pages; the patron manages and cancels there.

**Workers fit:** BT would call Patreon's HTTP API with `fetch` (OAuth tokens per ADR-004); there is no SDK to run.

**Webhooks:** Patreon signs its webhooks with HMAC-MD5 (`X-Patreon-Signature`, the agent's understanding, to be checked); standard Web Crypto has no MD5, but Workers' `crypto.subtle` adds MD5 as a digest, and BT's Worker already runs with `nodejs_compat` (`wrangler.jsonc`), so `node:crypto`'s `createHmac("md5", …)` can verify it; whether Workers' `crypto.subtle` also takes MD5 as an HMAC hash is to be checked.

**Event order:** No order promised (the agent's understanding); applied as the section's opening says (ADR-022).

**Test mode:** None as such; a test needs a second Patreon page and real pledges, or fixtures (ADR-013).

**Personal data:** The patron's Patreon user id (`patreonUserId`, already labelled) and OAuth refresh token, stored encrypted (ADR-004, ADR-019), and the tier.

### Stripe Billing and Stripe Tax

**Support types:** Both: Checkout takes one-off payments and Billing subscriptions, monthly or yearly.

**Refunds and disputes:** BT issues refunds itself (the processing fee is not returned, the agent's understanding); disputes cost "$15.00" each, and a second $15 to respond, refunded only if won (https://stripe.com/pricing, read 2026-11-28); BT answers each dispute.

**Payouts:** To BT's bank account; standard-schedule payouts are free, instant payouts 1.5% with a 50¢ minimum (same page); frequency is a rolling daily or weekly schedule BT sets (the agent's understanding).

**Customer portal:** Stripe Billing's hosted customer portal lets a supporter update a card or cancel (the agent's understanding, to be checked).

**Workers fit:** Stripe's Node library can run in a Worker with its fetch-based HTTP client (the agent's understanding), or BT calls Stripe's HTTP API with `fetch`, which needs nothing but the secret key.

**Webhooks:** The `Stripe-Signature` header carries a timestamp and `v1` HMAC-SHA256 signatures of `{timestamp}.{raw body}` (https://docs.stripe.com/webhooks, read 2026-11-28); Web Crypto's HMAC-SHA256 verifies it without Node's `crypto`, with a constant-time comparison and a tolerance on the timestamp.

**Event order:** "Stripe doesn't guarantee the delivery of events in the order that they're generated", and its docs say not to order by `created`; track event ids for duplicates and retrieve the object for its current state (same page), which is the section's plan (ADR-022).

**Test mode:** Sandboxes with test keys and test cards; the Stripe CLI forwards and triggers events locally.

**Personal data:** Stripe's customer id and subscription id, the subscription's status and period end; card details and the billing address stay at Stripe (BT never sees the card). As merchant of record BT also keeps each sale's tax evidence (the buyer's country) for its VAT records, which ADR-028's inventory would gain.

### Paddle

**Support types:** Subscriptions and one-off purchases of a product; whether a tip with nothing unlocked is allowed is to be checked (Tax).

**Refunds and disputes:** Paddle handles chargebacks as merchant of record (its pricing page lists chargebacks as handled, https://www.paddle.com/pricing, read 2026-11-28); refunds are requested through Paddle; no fee is on the page.

**Payouts:** Not on the pricing page; the agent understands Paddle pays out monthly above a minimum, to be checked.

**Customer portal:** Paddle offers a hosted portal where a buyer manages or cancels a subscription (the agent's understanding, to be checked).

**Workers fit:** BT calls Paddle's REST API with `fetch`; whether Paddle's Node SDK runs in a Worker is not checked, and isn't needed.

**Webhooks:** The `Paddle-Signature` header is `ts=…;h1=…`, an HMAC with SHA256 of the timestamp and the raw body joined by a colon (https://developer.paddle.com/webhooks/signature-verification, read 2026-11-28); Web Crypto verifies it.

**Event order:** The page doesn't promise order; it advises checking whether an event id was already processed, so the section's plan applies (ADR-022).

**Test mode:** A sandbox environment with its own keys (the agent's understanding, to be checked).

**Personal data:** Paddle's customer and subscription ids and the subscription's status; the buyer's card, address and tax evidence stay at Paddle as seller.

### Polar

**Support types:** Subscriptions and one-off products (the agent's understanding: Polar sells products and subscriptions; its pricing page names a subscription fee only for one plan); a tip with nothing unlocked is to be checked.

**Refunds and disputes:** Disputes "$15 per dispute, regardless of outcome", deducted from BT's balance (https://polar.sh/resources/pricing, read 2026-11-28); refunds are not on the page.

**Payouts:** Through Stripe, which charges $2 a month of active payouts plus 0.25% + $0.25 a payout, and "Polar does not add any extra fees or markup"; manual withdrawals let BT choose when (same page); no minimum or schedule stated.

**Customer portal:** Polar offers a customer portal for subscriptions (the agent's understanding, to be checked).

**Workers fit:** BT calls Polar's HTTP API with `fetch`; its TypeScript SDK is fetch-based (the agent's understanding, to be checked).

**Webhooks:** Standard Webhooks for secrets made on or after 8 September 2026: headers `webhook-id`, `webhook-timestamp` and `webhook-signature`, a base64 HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{body}` prefixed `v1,` (https://polar.sh/docs/integrate/webhooks/delivery, read 2026-11-28); Web Crypto verifies it.

**Event order:** Polar holds an event while earlier ones for the endpoint are pending, but "Order isn't guaranteed"; `webhook-id` is the event id, the same on every retry and redelivery, for deduplicating (same page); the section's plan applies (ADR-022).

**Test mode:** A sandbox environment (the agent's understanding, to be checked).

**Personal data:** Polar's customer and subscription ids and status; the buyer's card and address stay at Polar and Stripe.

### Stripe Managed Payments

**Support types:** One-off payments through Checkout or Payment Links, and subscriptions "Available with Billing"; subscriptions can be created only through Checkout or Payment Links (https://docs.stripe.com/payments/managed-payments, read 2026-11-28). A tip with nothing unlocked may not be an eligible product (Tax).

**Refunds and disputes:** Stripe handles disputes as merchant of record, and "Stripe can issue refunds within 60 days of purchase in certain cases, including to help reduce chargebacks"; continued use requires "a low historical dispute rate" (https://docs.stripe.com/payments/managed-payments/eligibility, read 2026-11-28).

**Payouts:** As Stripe's (above), to the agent's understanding; not stated on the Managed Payments pages read.

**Customer portal:** Stripe offers "transaction-level customer support" as merchant of record (Managed Payments page), and Billing's customer portal for subscriptions (the agent's understanding).

**Workers fit:** As Stripe Billing's: Stripe's HTTP API with `fetch`.

**Webhooks:** As Stripe Billing's: `Stripe-Signature`, HMAC-SHA256, verified with Web Crypto.

**Event order:** As Stripe Billing's: no order promised; the section's plan applies (ADR-022).

**Test mode:** As Stripe Billing's: sandboxes and the Stripe CLI.

**Personal data:** As Stripe Billing's ids and status; the tax evidence stays with Stripe as seller.

## By support model

Which candidates fit each of SUPPORT-MODEL's three models. Which model the owner chose is recorded here once the owner answers SUPPORT-MODEL's question (the story parks for it).

- **Model A: no perks.** A tip-capable provider is enough, and BT needs no entitlement webhooks at all. Plain Stripe fits best (one-off and recurring payments, the lowest fees); the merchant-of-record services exist to sell products and may not take a gift with nothing unlocked (Paddle, Polar and Stripe Managed Payments, each to be checked); Patreon fits too, at its higher cut.
- **Model B: one membership.** Needs subscriptions whose state BT reads by webhook. Every candidate fits; the choice is between the lowest fee with BT filing tax itself (Stripe Billing + Stripe Tax) and a merchant of record that files it (Stripe Managed Payments, Paddle, Polar).
- **Model C: tiers.** As Model B, plus upgrades and downgrades between prices, which every candidate supports (the agent's understanding); the webhook plan's "fetch the current state" step covers a plan change too.

## Recommendation

Drafted before the owner's model answer; it is settled only once that answer is recorded. If the owner chooses Model B or C, **Stripe Managed Payments**: it does the tax work the owner asked about (Stripe is the seller of record, filing sales tax and VAT in more than 80 countries), is the same Stripe account and API as plain Stripe (so a later move to Stripe Billing + Stripe Tax is a setting and a tax registration, not a new integration), and its webhooks verify with Web Crypto in a Worker. On cost it is cheaper only at small monthly prices: on a US card it costs less than Paddle and Polar on a one-off payment and on a monthly $3 or $5, about the same on a monthly $10 ($1.01 against $1.00), and more on every annual price ($2.86, $4.56 and $8.82 against Paddle's and Polar's $2.30, $3.50 and $6.50); on an EU card it costs less than Paddle only below $10 (and less than Polar on a one-off $10 too, $1.09 against $1.15). Its cut leans more on its percentage than theirs do, so annual billing saves it less (US card: 10.1% at monthly $10 to 7.4% at annual $120, against Paddle's 10.0% to 5.4%). So if most members would pay yearly, Paddle is the cheaper merchant of record, at the cost of a second company beside Stripe. If the owner chooses Model A, **plain Stripe** (Checkout for one-off and recurring support, Billing for the recurring), since a merchant of record may not take a gift and BT sells nothing to tax.

Whatever the owner chooses, accepted architecture may have to change with it. Moving payments off Patreon departs from ADR-004 (payments *"Remain on Patreon"*) and ADR-019 (*"payments stay on Patreon"*) and changes ADR-022's *"Patreon webhooks"* dedupe line; retiring or reshaping v2's four tiers (Model A, Model B, or Model C with new tiers) departs from ADR-004's product gates that *"carry v2"* (Backer → Pro → Star → Premium). Either needs the proposed ADR-019 amendment this story drafts after the provider answer (AC 12), which names the ADR-022 line it changes; accepting it is the owner's decision. Staying on Patreon with v2's four tiers as they are departs from none of them.

## Question for the owner

Asked after SUPPORT-MODEL's question is answered.

**Which payment provider should take supporters' money?**

1. **Stripe Managed Payments (Recommended).** Stripe sells on BT's behalf and files sales tax and VAT. On a US card, about 10% of a monthly $10 and 7% of an annual $120: cheaper than Paddle and Polar below $10 a month, dearer on every annual price.
2. **Stripe Billing + Stripe Tax.** On a US card the lowest fees (about 7% of a monthly $10, 4% of an annual $120), but BT registers for EU VAT before its first EU sale and files every return itself.
3. **Paddle.** Seller of record; 5% + 50¢ per payment on any card (10% of a monthly $10, 5% of an annual $120), the cheapest merchant of record on annual prices (tied with Polar on a US card); bespoke pricing under $10.
4. **Polar.** Seller of record; on a US card the same as Paddle, on an EU card 1.5% more (11.5% of a monthly $10, 6.9% of an annual $120), and payout fees through Stripe.
5. **Stay on Patreon.** No migration, and it handles the tax. On its current 10% plan (estimated) its cut is the highest of the current-plan rows here (Patreon's legacy Premium plan, at 12%, takes more still) at monthly $5 and $10 and on every annual price, though Paddle and Polar take more at monthly $3; its legacy Lite plan costs less than Paddle and Polar at monthly $3 and $5, and Pro at $3 (all estimated; which plan is BT's is asked separately).
