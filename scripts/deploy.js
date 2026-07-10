const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("Network :", hre.network.name);
  console.log("Deployer :", deployer.address);
  console.log("ETH bal :", hre.ethers.formatEther(balance), "ETH");
  console.log("");

  if (balance === 0n) throw new Error("Deployer has no ETH");

  // Mainnet: use real CLT address
  // Testnet: deploy MockERC20 first and use that address
  const CLT_MAINNET = "0xAE1e1b4D8f590371b77bEe27257ef038D4B835A1";

  let cltAddress;

  if (hre.network.name === "mainnet") {
    cltAddress = CLT_MAINNET;
    console.log("Using mainnet CLT :", cltAddress);
  } else if (process.env.SEPOLIA_CLT_ADDRESS) {
    cltAddress = process.env.SEPOLIA_CLT_ADDRESS;
    console.log("Using existing test CLT :", cltAddress);
  } else {
    console.log("Deploying MockERC20 (test CLT)...");
    const MockFactory = await hre.ethers.getContractFactory("MockERC20");
    const mockCLT = await MockFactory.deploy(
      "Chicago Loop Token",
      "CLT",
      hre.ethers.parseEther("1000000000")
    );
    await mockCLT.waitForDeployment();
    cltAddress = await mockCLT.getAddress();
    console.log("MockERC20 (CLT) deployed to:", cltAddress);
  }

  console.log("");
  console.log("Deploying ChicagoStaking...");
  const StakingFactory = await hre.ethers.getContractFactory("ChicagoStaking");
  const staking = await StakingFactory.deploy(cltAddress);
  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();

  console.log("");
  console.log("=== DEPLOYED ADDRESSES ===");
  console.log("CLT      :", cltAddress);
  console.log("Staking  :", stakingAddress);
  console.log("");
  console.log("Verify with:");
  console.log(`npx hardhat verify --network ${hre.network.name} ${stakingAddress} "${cltAddress}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
