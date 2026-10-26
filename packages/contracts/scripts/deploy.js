// Deploys MediChainRegistry with admin = deployer.
// Usage: npx hardhat run scripts/deploy.js --network <hardhat|localhost|sepolia>
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { exportAbi } = require("./abi");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error(`No deployer account configured for network "${network.name}".`);

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`Deploying MediChainRegistry to "${network.name}" (chainId ${chainId}) from ${deployer.address}...`);

  const Factory = await ethers.getContractFactory("MediChainRegistry");
  const registry = await Factory.deploy(deployer.address);
  const deployTx = registry.deploymentTransaction();
  const receipt = await deployTx.wait();
  const address = await registry.getAddress();
  console.log(`MediChainRegistry deployed at ${address} (tx ${deployTx.hash}, block ${receipt.blockNumber})`);

  const relayer = process.env.RELAYER_ADDRESS;
  if (relayer) {
    if (!ethers.isAddress(relayer)) throw new Error(`RELAYER_ADDRESS is not a valid address: ${relayer}`);
    if (ethers.getAddress(relayer) !== deployer.address) {
      for (const roleName of ["RECORDER_ROLE", "REGULATOR_ROLE"]) {
        const role = await registry[roleName]();
        await (await registry.grantRole(role, relayer)).wait();
        console.log(`Granted ${roleName} to relayer ${relayer}`);
      }
    } else {
      console.log("RELAYER_ADDRESS equals deployer; it already holds all roles.");
    }
  }

  const deployment = {
    network: network.name,
    chainId,
    address,
    deployer: deployer.address,
    blockNumber: receipt.blockNumber,
    txHash: deployTx.hash,
    deployedAt: new Date().toISOString(),
  };
  const deploymentsDir = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`Deployment info written to ${deploymentFile}`);

  const abiFile = exportAbi();
  console.log(`ABI written to ${abiFile}`);

  console.log("\n============================================================");
  console.log(" Next step: set the contract address in apps/api/.env");
  console.log(`   CONTRACT_ADDRESS=${address}`);
  if (network.name === "hardhat") {
    console.log(" NOTE: the in-process 'hardhat' network is discarded when this script exits.");
    console.log(" For a persistent chain run `npm run node` then `npm run deploy:local`.");
  }
  console.log("============================================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
