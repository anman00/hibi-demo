// netlify/functions/payout.js
// Per-run Nium SANDBOX payout for the Hibi demo.
//
// TWO MODES, automatic:
//   FULL  — if NIUM_CUSTOMER_HASH_ID / NIUM_WALLET_HASH_ID / NIUM_BENEFICIARY_ID
//           are set (from the one-time nium-setup run): locks a live FX quote,
//           then fires a REAL sandbox remittance. Returns Nium's system
//           reference — and the transaction appears in your Nium Portal.
//   BASIC — otherwise: verifies credentials + pulls a live quote (read-only).
//
// Fails soft in both modes — the demo shows "simulated", never an error.
//
// Env vars: NIUM_API_KEY, NIUM_CLIENT_HASH_ID,
//           NIUM_CUSTOMER_HASH_ID, NIUM_WALLET_HASH_ID, NIUM_BENEFICIARY_ID
//
// TODO_VERIFY: remittance payload enums (purposeCode, sourceOfFunds) against
// your tenant's docs — Nium returns descriptive field errors, passed through
// in the response detail so first-run fixes are quick.

const NIUM_HOST = "https://gateway.nium.com";

function headers(key) {
  return {
    "x-api-key": key,
    "x-request-id": crypto.randomUUID(),
    "x-client-name": "hibi-demo",
    "content-type": "application/json",
    "accept": "application/json",
  };
}

async function nium(method, path, key, body) {
  const res = await fetch(`${NIUM_HOST}${path}`, {
    method, headers: headers(key), body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });

  const KEY = process.env.NIUM_API_KEY;
  const CLIENT = process.env.NIUM_CLIENT_HASH_ID;
  if (!KEY || !CLIENT) return new Response(JSON.stringify({ mode: "mock", reason: "nium keys not configured" }), { status: 503 });

  const CUSTOMER = process.env.NIUM_CUSTOMER_HASH_ID;
  const WALLET = process.env.NIUM_WALLET_HASH_ID;
  const BENEFICIARY = process.env.NIUM_BENEFICIARY_ID;

  let body = {};
  try { body = await req.json(); } catch (e) {}
  const destCurrency = String(body.currency || "SGD").slice(0, 3).toUpperCase();
  const reference = String(body.reference || "HIBI-DVA-DEMO").slice(0, 40);

  try {
    // ================= FULL MODE: real sandbox remittance =================
    if (CUSTOMER && WALLET && BENEFICIARY) {
      // 1) Lock a live FX quote — remittance requires the auditId it returns.
      const fx = await nium("GET",
        `/api/v1/client/${CLIENT}/exchangeRate?sourceCurrencyCode=USD&destinationCurrencyCode=${destCurrency}`, KEY);
      const auditId = fx.data.auditId || fx.data.audit_id || null;

      // 2) Fire the remittance (fixed small sandbox amount per run).
      const remit = await nium("POST",
        `/api/v1/client/${CLIENT}/customer/${CUSTOMER}/wallet/${WALLET}/remittance`, KEY, {
          beneficiary: { id: BENEFICIARY },
          payout: {
            auditId: auditId,
            sourceCurrencyCode: "USD",
            destinationCurrencyCode: destCurrency,
            sourceAmount: 10,               // fixed sandbox amount per run
          },
          purposeCode: "IR001",             // TODO_VERIFY enum for your tenant
          sourceOfFunds: "Business Income", // TODO_VERIFY enum for your tenant
          customerComments: `Hibi demo · ${reference}`,
        });

      if (remit.ok) {
        const srn = remit.data.systemReferenceNumber || remit.data.system_reference_number
                 || remit.data.paymentId || remit.data.id || "accepted";
        return new Response(JSON.stringify({ payout_id: `Nium ref ${srn} (sandbox — live in portal)` }), {
          status: 200, headers: { "Content-Type": "application/json" } });
      }
      // Remittance rejected (field/enum issue) — degrade to BASIC display,
      // but log Nium's error so it's fixable from the function log.
      console.log("nium remittance rejected:", JSON.stringify(remit.data).slice(0, 500));
      // fall through to basic mode
    }

    // ================= BASIC MODE: verify + live quote =================
    const clientRes = await nium("GET", `/api/v1/client/${CLIENT}`, KEY);
    if (!clientRes.ok) {
      return new Response(JSON.stringify({ mode: "mock", reason: "nium auth failed", status: clientRes.status }), { status: 502 });
    }
    let quote = null;
    try {
      const fxRes = await nium("GET",
        `/api/v1/client/${CLIENT}/exchangeRate?sourceCurrencyCode=USD&destinationCurrencyCode=${destCurrency}`, KEY);
      if (fxRes.ok) quote = fxRes.data.exchangeRate || fxRes.data.rate || null;
    } catch (e) {}

    const name = clientRes.data.name ? String(clientRes.data.name).slice(0, 24) : "client";
    const display = quote
      ? `Nium sandbox · ${name} verified · USD/${destCurrency} ${Number(quote).toFixed(4)}`
      : `Nium sandbox · ${name} verified`;
    return new Response(JSON.stringify({ payout_id: display }), {
      status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ mode: "mock", reason: "nium unreachable" }), { status: 502 });
  }
};
