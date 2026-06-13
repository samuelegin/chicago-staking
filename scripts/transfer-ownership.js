/**
 * transfer-ownership.js
 * ─────────────────────
 * Transfers ChicagoStaking contract ownership to a Gnosis Safe multisig.
 *
 * STEPS TO RUN:
 *   1. Set STAKING_ADDRESS and SAFE_ADDRESS below (or use env vars)
 *   2. npx hardhat run scripts/transfer-ownership.js --network <network>
 *
 * BEFORE RUNNING:
 *   - Make sure SAFE_ADDRESS is your deployed Gnosis Safe
 *   - Confirm the Safe is set up with the correct signers and threshold
 *   - Do a dry run first: set DRY_RUN=true below
*/

const hre = require("hardhat");
const STAKING_ADDRESS = process.env.STAKING_ADDRESS || ""   // deployed ChicagoStaking address
const SAFE_ADDRESS = process.env.SAFE_ADDRESS || ""   // Gnosis Safe address
const DRY_RUN = process.env.DRY_RUN === "true"      // set to true to simulate only
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (!STAKING_ADDRESS) throw new Error("Set STAKING_ADDRESS env var or hardcode it above")
  if (!SAFE_ADDRESS)    throw new Error("Set SAFE_ADDRESS env var or hardcode it above")

  const [deployer] = await hre.ethers.getSigners()

  console.log("Network :", hre.network.name)
  console.log("Executor :", deployer.address)
  console.log("Staking contract:", STAKING_ADDRESS)
  console.log("New owner (Safe):", SAFE_ADDRESS)
  console.log("Dry run :", DRY_RUN)
  console.log("")

  const staking = await hre.ethers.getContractAt("ChicagoStaking", STAKING_ADDRESS)
  const currentOwner = await staking.owner()
  console.log("Current owner   :", currentOwner)

  if (currentOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Executor (${deployer.address}) is not the current owner (${currentOwner})`)
  }

  if (SAFE_ADDRESS.toLowerCase() === deployer.address.toLowerCase()) {
    throw new Error("Safe address is the same as the current owner — nothing to do")
  }

  if (DRY_RUN) {
    console.log("\n Dry run passed. Remove DRY_RUN=true to execute the real transfer.")
    return
  }

  console.log("\nSending transferOwnership tx…")
  const tx = await staking.transferOwnership(SAFE_ADDRESS)
  console.log("Tx hash:", tx.hash)
  console.log("Waiting for confirmation…")
  await tx.wait()

  const newOwner = await staking.owner()
  if (newOwner.toLowerCase() !== SAFE_ADDRESS.toLowerCase()) {
    throw new Error(`Transfer failed — owner is still ${newOwner}`)
  }

  console.log("\nOwnership transferred successfully!")
  console.log("New owner:", newOwner)
  console.log("")
  console.log("IMPORTANT: Verify the Gnosis Safe can execute transactions on the contract")
  console.log("before decommissioning the old deployer wallet.")
}

main().catch((err) => {
  console.error("\n", err.message)
  process.exit(1)
})
