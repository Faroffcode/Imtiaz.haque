const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { ...JSON_HEADERS, ...extra }
  });
}

function secureEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function bearer(request) {
  const match = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(value)
  ));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function allowedCallback(raw, env) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const hosts = (env.CALLBACK_ALLOWED_HOSTS || "")
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  return hosts.includes(url.hostname.toLowerCase()) ? url : null;
}

async function razorpay(env, path, options = {}) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay credentials are not configured");
  }
  const response = await fetch("https://api.razorpay.com/v1" + path, {
    ...options,
    headers: {
      authorization: "Basic " + btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET),
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    const error = new Error(data?.error?.description || "Razorpay request failed");
    error.status = response.status;
    error.details = data?.error?.description;
    throw error;
  }
  return data;
}

async function authError(request, env) {
  if (!env.FAROFF_API_KEY) return json({ success: false, error: "API is not configured" }, 500);
  if (!secureEqual(bearer(request), env.FAROFF_API_KEY)) {
    return json({ success: false, error: "Unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }
  return null;
}

async function createLink(request, env) {
  const unauthorized = await authError(request, env);
  if (unauthorized) return unauthorized;

  let input;
  try { input = await request.json(); } catch {
    return json({ success: false, error: "Body must be valid JSON" }, 400);
  }

  const { amount, description, reference_id: referenceId } = input || {};
  const currency = input?.currency || "INR";
  const callbackRaw = input?.webhook_url || input?.callback_url;

  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 100000000) {
    return json({ success: false, error: "amount must be integer paise, from 100 to 100000000" }, 400);
  }
  if (currency !== "INR") return json({ success: false, error: "Only INR is enabled" }, 400);
  if (typeof description !== "string" || !description.trim() || description.length > 2048) {
    return json({ success: false, error: "description is required (max 2048 characters)" }, 400);
  }
  if (typeof referenceId !== "string" || !/^[A-Za-z0-9_.:-]{1,40}$/.test(referenceId)) {
    return json({ success: false, error: "reference_id must be 1-40 safe characters" }, 400);
  }
  const callback = allowedCallback(callbackRaw, env);
  if (!callback) {
    return json({ success: false, error: "webhook_url must be HTTPS on a hostname listed in CALLBACK_ALLOWED_HOSTS" }, 400);
  }
  if (!env.CALLBACK_SIGNING_SECRET) {
    return json({ success: false, error: "Callback signing secret is not configured" }, 500);
  }

  try {
    const link = await razorpay(env, "/payment_links", {
      method: "POST",
      body: JSON.stringify({
        amount, currency, accept_partial: false, description: description.trim(),
        reference_id: referenceId,
        notes: {
          faroff_reference_id: referenceId,
          faroff_callback_url: callback.toString()
        },
        notify: { sms: false, email: false },
        reminder_enable: false
      })
    });
    return json({
      success: true, payment_id: link.id, reference_id: link.reference_id || referenceId,
      payment_url: link.short_url, amount: link.amount, currency: link.currency, status: link.status
    }, 201);
  } catch (error) {
    console.error("Razorpay create link error", error.message);
    return json({
      success: false, error: "Could not create payment link",
      details: error.details || "Check Worker secrets and Razorpay Test Mode"
    }, error.status >= 400 && error.status < 500 ? 400 : 502);
  }
}

async function getLink(request, env, id) {
  const unauthorized = await authError(request, env);
  if (unauthorized) return unauthorized;
  if (!/^plink_[A-Za-z0-9]+$/.test(id)) {
    return json({ success: false, error: "Invalid payment link ID" }, 400);
  }
  try {
    const link = await razorpay(env, "/payment_links/" + encodeURIComponent(id));
    return json({ success: true, payment: {
      id: link.id, reference_id: link.reference_id || null,
      amount: link.amount, amount_paid: link.amount_paid, amount_due: link.amount_due,
      currency: link.currency, status: link.status, short_url: link.short_url,
      description: link.description, expire_by: link.expire_by || null
    }});
  } catch (error) {
    console.error("Razorpay status error", error.message);
    return json({ success: false, error: "Could not fetch payment status", details: error.details || "Check link ID" },
      error.status >= 400 && error.status < 500 ? 400 : 502);
  }
}

async function notifyRequester(env, rawUrl, eventName, referenceId, data) {
  const url = allowedCallback(rawUrl, env);
  if (!url) return { delivered: false, reason: "callback_not_allowed" };
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({ event: eventName, reference_id: referenceId || null, timestamp, data });
  const signature = await hmacHex(env.CALLBACK_SIGNING_SECRET, timestamp + "." + body);
  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-faroff-timestamp": timestamp,
        "x-faroff-signature": "sha256=" + signature,
        "user-agent": "FAROFF-Payment-API/1.0"
      },
      body,
      signal: AbortSignal.timeout(8000)
    });
    return { delivered: response.ok, status: response.status };
  } catch (error) {
    console.error("Requester callback failed", error.message);
    return { delivered: false, reason: "callback_request_failed" };
  }
}

async function razorpayWebhook(request, env) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    return json({ success: false, error: "Webhook secret is not configured" }, 500);
  }
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";
  const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw);
  if (!secureEqual(expected.toLowerCase(), signature.trim().toLowerCase())) {
    return json({ success: false, error: "Invalid webhook signature" }, 400);
  }

  let body;
  try { body = JSON.parse(raw); } catch {
    return json({ success: false, error: "Invalid JSON payload" }, 400);
  }
  const event = body?.event;
  const payload = body?.payload || {};
  let link = payload?.payment_link?.entity || null;
  const payment = payload?.payment?.entity || null;

  if (!link && payment) {
    const linkId = payment.payment_link_id || payment.invoice_id;
    if (typeof linkId === "string" && linkId.startsWith("plink_")) {
      try { link = await razorpay(env, "/payment_links/" + encodeURIComponent(linkId)); }
      catch (error) { console.warn("Could not resolve payment link", error.message); }
    }
  }

  const notes = link?.notes || {};
  const supported = new Set([
    "payment_link.paid", "payment_link.partially_paid",
    "payment_link.cancelled", "payment_link.expired", "payment.failed"
  ]);
  let callback = { delivered: false, reason: "event_ignored" };
  if (supported.has(event) && notes.faroff_callback_url) {
    const status = event === "payment_link.paid" ? "paid"
      : event === "payment_link.partially_paid" ? "partially_paid"
      : event === "payment_link.cancelled" ? "cancelled"
      : event === "payment_link.expired" ? "expired"
      : "payment_attempt_failed";
    callback = await notifyRequester(env, notes.faroff_callback_url,
      event.replace(".", "_"), notes.faroff_reference_id || link?.reference_id, {
        payment_link_id: link?.id || payment?.payment_link_id || payment?.invoice_id || null,
        payment_id: payment?.id || null,
        amount: payment?.amount ?? link?.amount ?? null,
        amount_paid: link?.amount_paid ?? null,
        amount_due: link?.amount_due ?? null,
        currency: payment?.currency || link?.currency || "INR",
        status
      });
  }
  // Without a database, failed callbacks cannot be queued for reliable retries.
  return json({ success: true, received: true, event: event || "unknown", callback });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-max-age": "86400"
      }});
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ success: true, service: "FAROFF Payment API", version: "1.0.0" });
    }
    if (request.method === "POST" && url.pathname === "/v1/payment-links") {
      return createLink(request, env);
    }
    const match = url.pathname.match(/^\/v1\/payment-links\/([^/]+)$/);
    if (request.method === "GET" && match) {
      return getLink(request, env, decodeURIComponent(match[1]));
    }
    if (request.method === "POST" && url.pathname === "/webhooks/razorpay") {
      return razorpayWebhook(request, env);
    }
    return json({ success: false, error: "Not found" }, 404);
  }
};
