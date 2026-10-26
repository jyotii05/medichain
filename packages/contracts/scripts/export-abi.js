// Exports the MediChainRegistry ABI to apps/api/src/blockchain/MediChainRegistry.abi.json.
// Run after compiling: `npm run export-abi` (compiles first) or `node scripts/export-abi.js`.
const { exportAbi } = require("./abi");

try {
  const out = exportAbi();
  console.log(`ABI written to ${out}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
