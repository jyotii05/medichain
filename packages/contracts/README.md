# @medichain/contracts

Hardhat project for **MediChainRegistry**, the on-chain traceability anchor of the MediChain medicine supply-chain demo.

The contract stores **only opaque `bytes32` references and hashes** (batch/org references, hashes of off-chain batch records and supply-chain events). It never stores personal, patient or confidential data. The off-chain MediChain API acts as an authorized relayer holding `RECORDER_ROLE` (and, for regulator actions, `REGULATOR_ROLE`).

Enforced on-chain:
- Custody route: Manufacturer -> Distributor -> Wholesaler -> Pharmacy (two-step initiate/accept, or reject).
- Only the current custodian can initiate; only the pending recipient can accept/reject; one pending transfer at a time.
- Regulator recalls block all further transfers.
- Every batch event updates `lastEventHash` and increments `eventCount`.

## Setup

```bash
cd packages/contracts
npm install
cp .env.example .env   # optional, only for Sepolia / relayer settings
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run compile` | Compile contracts |
| `npm test` | Run the test suite |
| `npm run node` | Start a local Hardhat node on http://127.0.0.1:8545 (chainId 31337) |
| `npm run deploy:local` | Deploy to the running local node |
| `npm run deploy:sepolia` | Deploy to Sepolia (requires `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY`) |
| `npm run export-abi` | Compile and write the ABI to `apps/api/src/blockchain/MediChainRegistry.abi.json` |
| `npm run clean` | Remove artifacts and cache |

## Local workflow

```bash
npm run node            # terminal 1
npm run deploy:local    # terminal 2
```

Deploy writes `deployments/<network>.json` and exports the ABI for the API. Then set `CONTRACT_ADDRESS=<address>` in `apps/api/.env`.

If `RELAYER_ADDRESS` is set and differs from the deployer, it is granted `RECORDER_ROLE` and `REGULATOR_ROLE`. With the default local node the deployer is Hardhat account #0, so the API can simply use that account's well-known private key **for local development only**.

## Environment (`.env`)

```
SEPOLIA_RPC_URL=
DEPLOYER_PRIVATE_KEY=
RELAYER_ADDRESS=
```

The `sepolia` network is only configured when both `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` are set. Never commit `.env`.
