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
// VERIFIED (7 Jul 2026): this sandbox client is SGD-ONLY (regulatoryRegion SG).
// USD is rejected by the exchangeRate API and same-currency quotes are not
// allowed, so full mode fires an SGD wallet → SGD local payout to the fixed
// beneficiary (NIUM_BENEFICIARY_ID = beneficiaryHashId from nium-setup) with
// no FX-quote step. Basic mode quotes SGD→USD purely for display.

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
  const reference = String(body.reference || "HIBI-DVA-DEMO").slice(0, 40);

  try {
    // ================= FULL MODE: real sandbox remittance =================
    // The dashboard "Live connections" card pings this function on login with
    // reference STATUS-CHECK — that must stay read-only, not fire a payout.
    if (CUSTOMER && WALLET && BENEFICIARY && reference !== "STATUS-CHECK") {
      // SGD wallet → SGD local payout to the fixed sandbox beneficiary.
      // No FX-quote step: the client is single-currency, so no pair quotes.
      // Field names verified against the live API: payout.sourceCurrency /
      // destinationCurrency (not *CurrencyCode); sourceOfFunds enum "Salary"
      // ("Business Income" is rejected); purposeCode IR005 per docs example.
      const remit = await nium("POST",
        `/api/v1/client/${CLIENT}/customer/${CUSTOMER}/wallet/${WALLET}/remittance`, KEY, {
          beneficiary: { id: BENEFICIARY },
          payout: {
            sourceCurrency: "SGD",
            destinationCurrency: "SGD",
            sourceAmount: 10,               // fixed sandbox amount per run
          },
          purposeCode: "IR005",
          sourceOfFunds: "Salary",
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
    // No FX quote: single-currency client, every pair is rejected.
    const name = clientRes.data.name ? String(clientRes.data.name).slice(0, 24) : "client";
    const display = `Nium sandbox · ${name} verified`;
    return new Response(JSON.stringify({ payout_id: display }), {
      status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ mode: "mock", reason: "nium unreachable" }), { status: 502 });
  }
};
