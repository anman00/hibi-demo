// netlify/functions/nium-setup.js
// ONE-TIME sandbox setup. Run once, copy the returned IDs into Netlify env
// vars, then this function is never needed again (you can even delete it).
//
// VERIFIED FLOW (11 Jul 2026, run live against the sandbox):
//   1. Create a corporate customer via the V5 API
//      (POST /api/v5/client/{c}/customers) — on this self-serve client it
//      returns status "clear" INSTANTLY, no KYB queue. The older v1/v2
//      onboarding APIs put customers into a compliance queue that never
//      resolves on this tenant (no ekycRedirectUrl, no simulated agent).
//   2. Add a beneficiary via POST /api/v2/.../beneficiaries (FLAT payload).
//   3. Fund the SGD wallet from the client prefund pool
//      (v2 fund, fundingChannel "prefund" — lowercase enums in v2).
//      This only works once a client prefund request has been APPROVED —
//      approval happens in the Nium portal, not via API. Two requests are
//      pending: CP8057725314 / CP7277418884 (SGD 10,000 each).
//
// This client is SGD-ONLY (regulatoryRegion SG): no USD, no FX quotes.
// payout.js fires SGD wallet → SGD local payout to the beneficiary below.
//
// Protection: requires header  x-setup-token: <NIUM_SETUP_TOKEN>
//
// Run after deploy:
//   curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/nium-setup \
//        -H "x-setup-token: YOUR_TOKEN"
// Idempotent: reuses the existing v5 customer and beneficiary on rerun.

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

// V5 corporate customer, SG region. All enum codes below come from
// GET /api/v2/client/{c}/onboarding/constants?region=SG&type=CORPORATE
// (they are region-specific; UK example codes from the docs are rejected).
// Note: v5 INDIVIDUAL onboarding is broken for SG on this tenant (its
// annualIncome constant table is missing server-side) — corporate only.
const SG_ADDRESS = {
  addressLine1: "22 Circular Road",
  addressLine2: "02-01",
  city: "Singapore",
  country: "SG",
  postcode: "049422",
  state: "Singapore",
};

const V5_CUSTOMER = {
  region: "SG",
  type: "corporate",
  kycType: "minimum",
  externalId: "hibi-demo-v5-corp-001",
  businessName: "Hibi Demo Trading Pte Ltd",
  businessRegistrationNumber: "202012345K",
  businessType: "PRIVATE_COMPANY",
  registeredCountry: "SG",
  registeredDate: "2020-07-20",
  website: "https://hibi-demo.netlify.app",
  addresses: { businessAddress: { ...SG_ADDRESS }, registeredAddress: { ...SG_ADDRESS } },
  sizeOfBusiness: { annualTurnover: "SG008", totalEmployees: "EM006" },
  natureOfBusiness: { industryCodes: ["IS134"] },
  expectedAccountUsage: {
    credit: { averageTransactionValue: "ATVSG02", monthlyTransactionVolume: "MVSG02", monthlyTransactions: "ATC01" },
    intendedUses: ["IU002"],
  },
  applicant: {
    address: { ...SG_ADDRESS },
    dateOfBirth: "1985-05-15",
    email: "hibi.applicant@example.com",
    externalId: "hibi-demo-v5-applicant",
    firstName: "Hibi",
    lastName: "Director",
    mobile: "80000002",
    mobileCountryCode: "65",
    nationality: "SG",
    positions: [{ title: "director" }],
    sharePercentage: 80,
  },
  stakeholders: {
    individual: [{
      address: { ...SG_ADDRESS },
      dateOfBirth: "1985-05-15",
      email: "hibi.applicant@example.com",
      externalId: "hibi-demo-v5-stk",
      firstName: "Hibi",
      lastName: "Director",
      mobile: 80000002,
      mobileCountryCode: 65,
      nationality: "SG",
      positions: [{ title: "director" }],
      sharePercentage: 80,
    }],
  },
};

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

  // ---- 1. V5 corporate customer: reuse existing, else create ----
  let customerHashId, walletHashId, customerStatus;
  const list = await nium("GET", `/api/v5/client/${CLIENT}/customers`, KEY);
  const existing = (list.data.customers || []).find((c) => c.type === "corporate");
  if (existing) {
    customerHashId = existing.customerHashId;
    walletHashId = (existing.wallets || [])[0]?.walletHashId;
    customerStatus = existing.status;
    log.customer = { reused: true, customerHashId, walletHashId, status: customerStatus };
  } else {
    const created = await nium("POST", `/api/v5/client/${CLIENT}/customers`, KEY, V5_CUSTOMER);
    log.customer = created;
    if (!created.ok) return finish(log, "v5 customer creation failed — check log.customer.data");
    customerHashId = created.data.customerHashId;
    walletHashId = (created.data.wallets || [])[0]?.walletHashId;
    customerStatus = created.data.status;
  }

  // ---- 2. Beneficiary: reuse existing, else create (FLAT v2 payload) ----
  let beneficiaryHashId;
  const benes = await nium("GET", `/api/v2/client/${CLIENT}/customer/${customerHashId}/beneficiaries?page=0&size=10`, KEY);
  const existingBene = (Array.isArray(benes.data) ? benes.data : benes.data.content || [])[0];
  if (existingBene && existingBene.beneficiaryHashId) {
    beneficiaryHashId = existingBene.beneficiaryHashId;
    log.beneficiary = { reused: true, beneficiaryHashId };
  } else {
    const bene = await nium("POST", `/api/v2/client/${CLIENT}/customer/${customerHashId}/beneficiaries`, KEY, {
      beneficiaryName: "Pioneer Components Pte Ltd",
      beneficiaryAccountType: "Corporate",
      beneficiaryCountryCode: "SG",
      beneficiaryAccountNumber: "0721145328",
      beneficiaryBankName: "DBS Bank",
      beneficiaryBankCode: "DBSSSGSG",
      destinationCountry: "SG",
      destinationCurrency: "SGD",
      payoutMethod: "LOCAL",
      routingCodeType1: "SWIFT",
      routingCodeValue1: "DBSSSGSG",
      beneficiaryContactCountryCode: "SG",
      autosweepPayoutAccount: false,
      defaultAutosweepPayoutAccount: false,
    });
    log.beneficiary = bene;
    if (!bene.ok) return finish(log, "beneficiary creation failed — check log.beneficiary.data");
    beneficiaryHashId = bene.data.beneficiaryHashId;
  }

  // ---- 3. Fund the SGD wallet from the client prefund pool ----
  // v2 fund uses LOWERCASE enums. Fails with a 500 while the client pool is
  // empty — approve a client prefund request in the Nium portal first.
  const fund = await nium("POST",
    `/api/v2/client/${CLIENT}/customer/${customerHashId}/wallet/${walletHashId}/fund`, KEY, {
      sourceCurrencyCode: "SGD",
      destinationCurrencyCode: "SGD",
      sourceAmount: 1000,
      fundingChannel: "prefund",
    });
  log.fund = fund;

  return finish(log, null, {
    message: fund.ok
      ? "SETUP COMPLETE — copy these values into Netlify env vars, then redeploy:"
      : "Customer + beneficiary ready (env vars below are final). Wallet funding failed — approve the pending client prefund in the Nium portal, then run this again:",
    NIUM_CUSTOMER_HASH_ID: customerHashId,
    NIUM_WALLET_HASH_ID: walletHashId,
    NIUM_BENEFICIARY_ID: beneficiaryHashId,
  });
};

function finish(log, error, success) {
  return new Response(JSON.stringify({ error: error || undefined, ...success, log }, null, 2), {
    status: error ? 502 : 200,
    headers: { "Content-Type": "application/json" },
  });
}
