// netlify/functions/nium-setup.js
// ONE-TIME sandbox setup. Run once, copy the returned IDs into Netlify env
// vars, then this function is never needed again (you can even delete it).
//
// What it does, in order:
//   1. Creates a sandbox customer  ->  customerHashId (+ walletHashId)
//   2. Funds the customer wallet with sandbox money (prefund simulation)
//   3. Adds a beneficiary ("Pioneer Components Pte Ltd", DBS SG)
//   4. Returns all IDs + raw Nium responses so any field errors are obvious
//
// Protection: requires header  x-setup-token: <NIUM_SETUP_TOKEN>
// (set NIUM_SETUP_TOKEN in Netlify env vars to any random string you choose,
//  so strangers with your URL can't create sandbox objects.)
//
// How to run it once after deploy:
//   curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/nium-setup \
//        -H "x-setup-token: YOUR_TOKEN"
//
// NOTE ON FIELD NAMES: endpoint paths and payload fields below follow Nium's
// v1 API patterns but MUST be verified against your sandbox's Postman
// collection / docs.nium.com — Nium rejects unknown/missing fields with
// descriptive errors, which this function passes back verbatim so you can
// fix quickly. Expect to adjust 1-3 field names on first run.

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
    method,
    headers: headers(key),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, path };
}

// Nium's gateway returns 403 "Missing Authentication Token" when a ROUTE
// doesn't exist (AWS API Gateway behaviour) — not an auth failure. So we try
// known path variants in order until one is a real endpoint.
function isRouteMiss(r) {
  return r.status === 403 && r.data && /Missing Authentication Token/i.test(r.data.message || "");
}
async function niumTryPaths(method, paths, key, body) {
  let last = null;
  for (const p of paths) {
    const r = await nium(method, p, key, body);
    if (!isRouteMiss(r)) return r;   // real endpoint (success OR a real validation error)
    last = r;
  }
  return last;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const KEY = process.env.NIUM_API_KEY;
  const CLIENT = process.env.NIUM_CLIENT_HASH_ID;
  const TOKEN = process.env.NIUM_SETUP_TOKEN;

  if (!KEY || !CLIENT) return new Response(JSON.stringify({ error: "NIUM_API_KEY / NIUM_CLIENT_HASH_ID not set" }), { status: 503 });
  if (!TOKEN || req.headers.get("x-setup-token") !== TOKEN) {
    return new Response(JSON.stringify({ error: "missing or wrong x-setup-token" }), { status: 401 });
  }

  const log = {};

  // ---- 1. Create sandbox customer (individual — simplest sandbox path) ----
  // Tries known path variants; "Missing Authentication Token" = route miss.
  const customer = await niumTryPaths("POST", [
    `/api/v1/client/${CLIENT}/customer`,
    `/api/v2/client/${CLIENT}/customer`,
    `/api/v4/client/${CLIENT}/customer`,
    `/api/v1/client/${CLIENT}/customers`,
  ], KEY, {
    firstName: "Hibi",
    lastName: "DemoMerchant",
    email: `hibi.demo.${Date.now()}@example.com`,
    countryCode: "SG",
    dateOfBirth: "1990-01-01",
    nationality: "SG",
    // Some tenants require: deliveryAddress1, city, state, postcode, mobile
    billingAddress1: "1 Demo Street",
    billingCity: "Singapore",
    billingCountry: "SG",
    billingZipCode: "018989",
    mobile: "80000000",
  });
  log.customer = customer;
  if (!customer.ok) return finish(log, "customer creation failed — check log.customer.data for the field Nium rejected");

  const customerHashId = customer.data.customerHashId || customer.data.customer_hash_id;
  const walletHashId = customer.data.walletHashId || customer.data.wallet_hash_id;

  // ---- 2. Fund the wallet with sandbox money (prefund simulation) ----
  const fund = await niumTryPaths("POST", [
    `/api/v1/client/${CLIENT}/customer/${customerHashId}/wallet/${walletHashId}/fund`,
    `/api/v1/client/${CLIENT}/customer/${customerHashId}/wallet/${walletHashId}/presignedFund`,
  ], KEY, {
      amount: 10000,
      destinationCurrencyCode: "USD",
      fundingChannel: "PREFUND",
      sourceCurrencyCode: "USD",
    });
  log.fund = fund; // non-fatal if it fails — some tenants prefund differently

  // ---- 3. Add beneficiary (the demo recipient) ----
  const beneficiary = await niumTryPaths("POST", [
    `/api/v1/client/${CLIENT}/customer/${customerHashId}/beneficiaries`,
    `/api/v2/client/${CLIENT}/customer/${customerHashId}/beneficiaries`,
    `/api/v1/client/${CLIENT}/customer/${customerHashId}/beneficiary`,
  ], KEY, {
      beneficiaryDetail: {
        firstName: "Pioneer",
        lastName: "Components",
        beneficiaryName: "Pioneer Components Pte Ltd",
        countryCode: "SG",
        beneficiaryAccountType: "Corporate",
      },
      payoutDetail: {
        destinationCurrency: "SGD",
        beneficiaryAccountNumber: "0721145328",
        payoutMethod: "LOCAL",
        routingCodeType1: "SWIFT",
        routingCodeValue1: "DBSSSGSG",
        beneficiaryBankName: "DBS Bank",
        beneficiaryCountryCode: "SG",
      },
    });
  log.beneficiary = beneficiary;
  if (!beneficiary.ok) return finish(log, "beneficiary creation failed — check log.beneficiary.data");

  const beneficiaryId =
    beneficiary.data.beneficiaryId || beneficiary.data.id ||
    (beneficiary.data.beneficiaryDetail && beneficiary.data.beneficiaryDetail.id);

  return finish(log, null, {
    message: "SETUP COMPLETE — copy these three values into Netlify env vars, then redeploy:",
    NIUM_CUSTOMER_HASH_ID: customerHashId,
    NIUM_WALLET_HASH_ID: walletHashId,
    NIUM_BENEFICIARY_ID: beneficiaryId,
  });
};

function finish(log, error, success) {
  return new Response(JSON.stringify({ error: error || undefined, ...success, log }, null, 2), {
    status: error ? 502 : 200,
    headers: { "Content-Type": "application/json" },
  });
}
