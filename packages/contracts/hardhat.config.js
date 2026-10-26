require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

/** @type {import('hardhat/config').HardhatUserConfig} */
const config = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

// Sepolia is only configured when both env vars are present. Keys are never hardcoded.
if (SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY) {
  const key = DEPLOYER_PRIVATE_KEY.startsWith("0x") ? DEPLOYER_PRIVATE_KEY : `0x${DEPLOYER_PRIVATE_KEY}`;
  config.networks.sepolia = {
    url: SEPOLIA_RPC_URL,
    accounts: [key],
    chainId: 11155111,
  };
}

module.exports = config;
