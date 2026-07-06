// netlify/functions/settle.js
// LIVE per-run settlement on Arbitrum Sepolia (testnet).
// Every demo run fires a REAL on-chain transaction — valueless testnet funds,
// but genuinely broadcast, mined, and independently verifiable on the explorer.
//
// Env vars (Netlify → Site settings → Environment variables — set by hand):
//   DEMO_WALLET_PK      — private key of the TESTNET-ONLY demo wallet ("Hibi Labuan demo")
//   SETTLE_TO           — recipient address (the "off-ramp partner" demo wallet)
//   TEST_USDC_ADDRESS   — optional: testnet USDC contract on Arbitrum Sepolia.
//                         If set, sends an ERC-20 USDC transfer (on-story).
//                         If absent, sends a native micro-transfer instead.
//
// SECURITY RULES — read before deploying:
//   * This wallet must ONLY ever hold testnet funds. Never a mainnet key.
//   * Anyone with the site URL can trigger a testnet transfer. That is fine
//     for valueless testnet tokens; it would NOT be fine for mainnet. Do not
//     repoint this at mainnet without adding authentication.
//   * Key lives only in Netlify env vars. Never in the repo or the HTML.

import { ethers } from "ethers";

//const RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const ERC20_ABI = ["function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)"];

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  const PK = process.env.DEMO_WALLET_PK;
  const TO = process.env.SETTLE_TO;
  const USDC = process.env.TEST_USDC_ADDRESS; // optional

  if (!PK || !TO) {
    return new Response(JSON.stringify({ mode: "mock", reason: "settlement wallet not configured" }), { status: 503 });
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(PK, provider);

    let tx;
    if (USDC) {
      // On-story: a real testnet USDC transfer (tiny fixed amount)
      const token = new ethers.Contract(USDC, ERC20_ABI, wallet);
      let decimals = 6;
      try { decimals = await token.decimals(); } catch (e) {}
      const amount = ethers.parseUnits("0.01", decimals); // fixed cap per run
      tx = await token.transfer(TO, amount);
    } else {
      // Fallback: native micro-transfer — still a real on-chain settlement
      tx = await wallet.sendTransaction({ to: TO, value: ethers.parseEther("0.00001") });
    }

    // Return the hash immediately; the frontend polls the public RPC for the receipt.
    return new Response(JSON.stringify({ hash: tx.hash, kind: USDC ? "usdc" : "native" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 120);
    return new Response(JSON.stringify({ mode: "mock", reason: "settlement failed", detail: msg }), { status: 502 });
  }
};
