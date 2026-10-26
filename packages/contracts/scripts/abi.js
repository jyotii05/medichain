const fs = require("fs");
const path = require("path");

/** Destination consumed by apps/api. */
const ABI_OUTPUT = path.resolve(__dirname, "../../../apps/api/src/blockchain/MediChainRegistry.abi.json");
const ARTIFACT = path.resolve(
  __dirname,
  "../artifacts/contracts/MediChainRegistry.sol/MediChainRegistry.json"
);

/** Reads the compiled artifact and writes the ABI JSON array for the API. Returns the output path. */
function exportAbi() {
  if (!fs.existsSync(ARTIFACT)) {
    throw new Error(`Artifact not found at ${ARTIFACT}. Run "npx hardhat compile" first.`);
  }
  const { abi } = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  fs.mkdirSync(path.dirname(ABI_OUTPUT), { recursive: true });
  fs.writeFileSync(ABI_OUTPUT, JSON.stringify(abi, null, 2) + "\n");
  return ABI_OUTPUT;
}

module.exports = { exportAbi, ABI_OUTPUT };
