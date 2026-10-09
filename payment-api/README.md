# FAROFF Payment API

Cloudflare Worker starter for your own websites and Telegram bots. It creates Razorpay Payment Links, checks link status, verifies Razorpay webhook signatures, and sends signed callbacks to an allowlisted HTTPS callback server.

This starter has no database. It cannot persist callback failures, deduplicate webhook deliveries, or maintain its own transaction history. Razorpay remains the payment-status source of truth. Add Cloudflare D1 before depending on automatic delivery in production.

## Endpoints

- `GET /health`
- `POST /v1/payment-links`
- `GET /v1/payment-links/{plink_id}`
- `POST /webhooks/razorpay`

## Deploy

Run commands from this `payment-api` directory:

```sh
npm install
npx wrangler login
npx wrangler deploy
```

Set secrets using Wrangler; never commit real credentials:

```sh
npx wrangler secret put FAROFF_API_KEY
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
npx wrangler secret put CALLBACK_SIGNING_SECRET
```

Use Razorpay Test Mode credentials first. Configure `CALLBACK_ALLOWED_HOSTS` in `wrangler.toml` with exact hostnames you control, comma-separated. Example: `api.example.com,bot.example.com`. Callback URLs must use HTTPS and exactly match one of these hostnames.

## Razorpay webhook

Set your Razorpay webhook URL to:

`https://YOUR-WORKER-URL/webhooks/razorpay`

Set the same webhook secret in the Worker and subscribe to applicable events such as `payment_link.paid`, `payment_link.partially_paid`, `payment_link.cancelled`, `payment_link.expired`, and `payment.failed`. Verify actual event availability and payloads in your Razorpay dashboard and test mode.

## Create a payment link

Amount is in paise: ₹99 = 9900.

```sh
curl -X POST "https://YOUR-WORKER-URL/v1/payment-links" \
  -H "Authorization: Bearer YOUR_FAROFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 9900,
    "currency": "INR",
    "description": "Software purchase",
    "reference_id": "ORDER_12345",
    "webhook_url": "https://api.example.com/payment-callback"
  }'
```

The hostname in `webhook_url` must be in `CALLBACK_ALLOWED_HOSTS`. The callback must be a backend endpoint, not a browser-only page.

## Callback signature

Outgoing callbacks include `X-Faroff-Timestamp` and `X-Faroff-Signature`. Signature is HMAC-SHA256 using `CALLBACK_SIGNING_SECRET` over `<timestamp>.<exact raw request body>`. The receiving server should verify the signature and reject old timestamps (for example, older than 5 minutes).

A `payment.failed` event is a failed attempt and does not necessarily mean the payment link itself has permanently failed; the customer may retry. Never deliver a product based only on a browser redirect. Confirm paid status server-side.

## Security and production notes

- Keep all secrets in Cloudflare Worker secrets.
- Do not expose the FAROFF API key in frontend/browser JavaScript.
- Restrict callback hostnames to servers you control.
- Add rate limiting and D1-backed deduplication/retry tracking before production.
- Test with Razorpay Test Mode.
- Confirm Razorpay permits your intended payment collection model before going live.
