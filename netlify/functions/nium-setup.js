// netlify/functions/nium-setup.js
// ONE-TIME sandbox setup. Run once, copy the returned IDs into Netlify env
// vars, then this function is never needed again (you can even delete it).
//
// VERIFIED FLOW (7 Jul 2026, run live against the sandbox):
//   1. Onboard a CORPORATE customer via POST /api/v1/client/{c}/corporate
//      using Nium's documented SG auto-approval example (businessRegistrationNumber
//      903287424M01233 → KYB auto-approves, sandbox only).
//      Individual customer creation is NOT enabled on this self-serve sandbox
//      client ("Unable to get compliance configuration") — corporate is the way.
//   2. Add a beneficiary via POST /api/v2/.../beneficiaries (FLAT payload,
//      not the nested beneficiaryDetail/payoutDetail shape).
//   3. Fund the SGD wallet (works only after KYB status = COMPLETED).
//
// This client is SGD-ONLY (regulatoryRegion SG): no USD, no FX quote.
// Remittance in payout.js is SGD wallet → SGD local payout.
//
// Protection: requires header  x-setup-token: <NIUM_SETUP_TOKEN>
//
// Run after deploy:
//   curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/nium-setup \
//        -H "x-setup-token: YOUR_TOKEN"
// If step 1 returns IN_PROGRESS, wait a few minutes and run again — it will
// find the existing customer, then do steps 2 and 3.

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

// Nium's documented SG sandbox auto-approval example (private company,
// manual KYB): businessRegistrationNumber 903287424M01233 triggers the
// auto-approval simulation — do not change it. The applicant kycMode is
// flipped to MANUAL_KYC (with passport docs) because this client has no
// ekycRedirectUrl configured, so any E_KYC participant gets stuck at the
// MyInfo redirect forever.
const CORPORATE_PAYLOAD = {
  "region": "SG",
  "businessDetails": {
    "referenceId": "6913aac9-cbd9-4783-8fd6-07ea9655dfec",
    "businessName": "Singapore Electronics 27779",
    "businessRegistrationNumber": "903287424M01233",
    "website": "www.singaporeelectronics.com",
    "businessType": "PRIVATE_COMPANY",
    "legalDetails": {
      "registeredCountry": "SG",
      "registeredDate": "2000-01-02"
    },
    "addresses": {
      "registeredAddress": {
        "addressLine1": "High Street 101, 56th Avenue",
        "addressLine2": "Hyung County",
        "city": "Singapore",
        "country": "SG",
        "postcode": "28046"
      }
    },
    "documentDetails": [
      {
        "documentType": "BUSINESS_REGISTRATION_DOC",
        "document": [
          {
            "document": "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII",
            "fileName": "BRD.pdf",
            "fileType": "application/pdf"
          }
        ]
      }
    ],
    "stakeholders": [
      {
        "referenceId": "d25c5c6f-d4b0-47a5-986e-7b50641b65fc",
        "stakeholderDetails": {
          "firstName": "Narendra",
          "middleName": "C",
          "lastName": "Bhargav",
          "dateOfBirth": "1982-07-17",
          "nationality": "IN",
          "kycMode": "MANUAL_KYC",
          "professionalDetails": [
            {
              "position": "DIRECTOR"
            },
            {
              "position": "UBO",
              "sharePercentage": "60"
            }
          ],
          "address": {
            "addressLine1": "7 Ang Mo Kio Street",
            "addressLine2": "64 No.01-01",
            "city": "Singapore",
            "country": "SG",
            "postcode": "28046"
          },
          "documentDetails": [
            {
              "documentType": "PASSPORT",
              "documentExpiryDate": "2029-09-10",
              "documentIssuanceCountry": "IN",
              "documentNumber": "098734524",
              "document": [
                {
                  "document": "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII",
                  "fileName": "Passport.pdf",
                  "fileType": "application/pdf"
                }
              ]
            }
          ]
        }
      },
      {
        "referenceId": "006ebeeb-3ede-4f49-8381-1e382334131c",
        "businessPartner": {
          "legalDetails": {
            "registeredCountry": "FR"
          },
          "businessEntityType": "SHAREHOLDER",
          "businessName": "Farto AgriTECH LIMITED",
          "businessRegistrationNumber": "822843822"
        }
      }
    ],
    "applicantDetails": {
      "referenceId": "0c61376b-70c3-4d45-9193-0a6ddece4e0e",
      "firstName": "Hardik",
      "middleName": "",
      "lastName": "Roshan",
      "dateOfBirth": "1982-07-17",
      "nationality": "SG",
      "kycMode": "MANUAL_KYC",
      "contactDetails": {
        "contactNo": "222268870",
        "countryCode": "SG",
        "email": "hardik@singel.com"
      },
      "professionalDetails": [
        {
          "position": "SIGNATORY"
        }
      ],
      "address": {
        "addressLine1": "7 Ang Mo Kio Street",
        "addressLine2": "64 No.01-01",
        "city": "Singapore",
        "country": "SG",
        "postcode": "28046"
      },
      "documentDetails": [
        {
          "documentType": "PASSPORT",
          "documentExpiryDate": "2029-09-10",
          "documentIssuanceCountry": "IN",
          "documentNumber": "098734525",
          "document": [
            {
              "document": "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII",
              "fileName": "Passport.pdf",
              "fileType": "application/pdf"
            }
          ]
        }
      ]
    },
    "additionalInfo": {
      "isSameBusinessAddress": "Yes",
      "searchId": "6nf3aac9-cbd9-423k-8fd6-07ea9345dfec"
    }
  },
  "riskAssessmentInfo": {
    "totalEmployees": "EM009",
    "annualTurnover": "SG011",
    "industrySector": "IS144",
    "intendedUseOfAccount": "IU003",
    "countryOfOperation": [
      "SG",
      "US",
      "GB"
    ],
    "transactionCountry": [
      "DE",
      "JP",
      "IN"
    ]
  },
  "tags": [
    {
      "key": "tag1",
      "value": "tag1value"
    },
    {
      "key": "tag2",
      "value": "tag2value"
    }
  ]
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

  // ---- 1. Corporate customer: reuse existing, else onboard ----
  let customerHashId, walletHashId, complianceStatus;
  const list = await nium("GET", `/api/v2/client/${CLIENT}/customers?page=0&size=10`, KEY);
  log.customerList = { status: list.status, totalElements: list.data.totalElements };
  const existing = (list.data.content || [])[0];
  if (existing) {
    customerHashId = existing.customerHashId;
    walletHashId = existing.walletHashId;
    complianceStatus = existing.complianceStatus;
    log.customer = { reused: true, customerHashId, walletHashId, complianceStatus };
  } else {
    const created = await nium("POST", `/api/v1/client/${CLIENT}/corporate`, KEY, CORPORATE_PAYLOAD);
    log.customer = created;
    if (!created.ok) return finish(log, "corporate onboarding failed — check log.customer.data");
    customerHashId = created.data.customerHashId;
    walletHashId = created.data.walletHashId;
    complianceStatus = created.data.status;
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

  // ---- 3. Fund the SGD wallet (requires KYB COMPLETED) ----
  const fund = await nium("POST",
    `/api/v1/client/${CLIENT}/customer/${customerHashId}/wallet/${walletHashId}/fund`, KEY, {
      amount: 1000,
      destinationCurrencyCode: "SGD",
      sourceCurrencyCode: "SGD",
      fundingChannel: "PREFUND",
    });
  log.fund = fund; // fails with "regulatory limits not found" until KYB completes — rerun later

  return finish(log, null, {
    message: fund.ok
      ? "SETUP COMPLETE — copy these values into Netlify env vars, then redeploy:"
      : `KYB status is ${complianceStatus} — auto-approval takes a few minutes; run this again until fund succeeds. Env vars below are already final:`,
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
