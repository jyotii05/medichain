/**
 * ON-CHAIN integration test (MediChainRegistry on a local Hardhat node).
 *
 * Runs only when a development chain (chainId 31337) is reachable at ONCHAIN_TEST_RPC
 * (default http://127.0.0.1:8545) and the contract has been compiled (packages/contracts/artifacts).
 * Otherwise the suite is skipped — start it with:
 *   cd packages/contracts && npx hardhat node        (separate terminal)
 *   cd packages/contracts && npx hardhat compile
 *
 * It deploys a fresh contract, switches the API into ONCHAIN mode for this test file only, and checks
 * that registrations, transfers and recalls are written on-chain, that the receipts' event logs carry the
 * database event hashes, and that DB tampering is detected by comparing against chain state.
 *
 * All imports of application code are dynamic so the environment can be configured first.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers';
import request from 'supertest';

const RPC = process.env.ONCHAIN_TEST_RPC ?? 'http://127.0.0.1:8545';
// Hardhat's well-known development account #0 — public, worthless outside a local dev chain.
const HARDHAT_DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ARTIFACT = fileURLToPath(new URL('../../../packages/contracts/artifacts/contracts/MediChainRegistry.sol/MediChainRegistry.json', import.meta.url));

async function devChainAvailable() {
  if (!existsSync(ARTIFACT)) return false;
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(8000),
    });
    const { result } = (await res.json()) as { result?: string };
    return result === '0x7a69'; // 31337 — never run against a real network
  } catch {
    return false;
  }
}

const available = await devChainAvailable();

describe.skipIf(!available)('on-chain mode (local Hardhat node)', () => {
  // populated in beforeAll via dynamic imports
  let h: typeof import('./helpers.js');
  let dispatchPending: () => Promise<void>;
  let contractAddress: string;

  beforeAll(async () => {
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
    const provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
    const deployer = new Wallet(HARDHAT_DEV_KEY, provider);
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const contract = await factory.deploy(deployer.address);
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();
    provider.destroy();

    process.env.BLOCKCHAIN_MODE = 'onchain';
    process.env.CHAIN_RPC_URL = RPC;
    process.env.CONTRACT_ADDRESS = contractAddress;
    process.env.RELAYER_PRIVATE_KEY = HARDHAT_DEV_KEY;

    h = await import('./helpers.js');
    ({ dispatchPending } = await import('../src/blockchain/onchain.js'));
    await h.freshBase();
  }, 120_000);

  afterAll(async () => {
    await h?.prisma.$disconnect();
  });

  it('anchors the full custody lifecycle on-chain and verifies event logs', async () => {
    const mfr = await h.login('manufacturer');
    const dist = await h.login('distributor');
    const reg = await h.login('regulator');

    const created = await mfr.post('/api/batches', h.batchPayload());
    expect(created.status).toBe(201);
    const batch = created.body.batch as { id: string; publicId: string };
    await dispatchPending();

    const registerTx = await h.prisma.blockchainTransaction.findFirstOrThrow({ where: { batchId: batch.id, operation: 'REGISTER_BATCH' } });
    expect(registerTx.mode).toBe('ONCHAIN');
    expect(registerTx.status).toBe('CONFIRMED');
    expect(registerTx.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(registerTx.blockNumber).toBeGreaterThan(0);
    expect(registerTx.simulatedRef).toBeNull();
    expect(registerTx.contractAddress?.toLowerCase()).toBe(contractAddress.toLowerCase());

    // custody transfer manufacturer -> distributor
    const orgs = await dist.get('/api/auth/me');
    const shipped = await mfr.post('/api/transfers', { batchId: batch.id, toOrgId: orgs.body.user.organization.id });
    expect(shipped.status).toBe(201);
    await dispatchPending();
    const accepted = await dist.post(`/api/transfers/${shipped.body.transfer.id}/accept`, {});
    expect(accepted.status).toBe(200);
    await dispatchPending();

    const verify = await request(h.app).get(`/api/verify/${batch.publicId}`);
    expect(verify.status).toBe(200);
    expect(verify.body.result).toBe('VERIFIED');
    expect(verify.body.chain.mode).toBe('ONCHAIN');
    expect(verify.body.chain.available).toBe(true);
    expect(verify.body.chain.consistent).toBe(true);
    expect(verify.body.chain.latest.kind).toBe('TX_HASH');
    expect(verify.body.chain.latest.logCheck).toMatch(/TransferAccepted event .* carries the expected hash/);

    // per-record re-verification reads the receipt logs
    const acceptTx = await h.prisma.blockchainTransaction.findFirstOrThrow({ where: { batchId: batch.id, operation: 'ACCEPT_TRANSFER' } });
    const reverify = await reg.post(`/api/blockchain/transactions/${acceptTx.id}/verify`);
    expect(reverify.body).toMatchObject({ mode: 'ONCHAIN', verified: true });

    // regulator recall is written on-chain
    const recall = await reg.post('/api/recalls', { batchId: batch.id, action: 'RECALL', classification: 'CLASS_II', reason: 'On-chain integration test recall' });
    expect(recall.status).toBe(201);
    await dispatchPending();
    const recallTx = await h.prisma.blockchainTransaction.findFirstOrThrow({ where: { batchId: batch.id, operation: 'RECALL_BATCH' } });
    expect(recallTx.status).toBe('CONFIRMED');

    const status = await reg.get('/api/blockchain/status');
    expect(status.body).toMatchObject({ mode: 'ONCHAIN', connected: true, relayerHasRoles: true });
    expect(status.body.totals.failed).toBe(0);
  });

  it('detects database tampering by comparing with on-chain state', async () => {
    const mfr = await h.login('manufacturer');
    const created = await mfr.post('/api/batches', h.batchPayload());
    const batch = created.body.batch as { id: string; publicId: string };
    await dispatchPending();

    // Move custody in the database without any transfer (simulated insider tampering).
    const pharmacy = await h.prisma.organization.findFirstOrThrow({ where: { type: 'PHARMACY', status: 'APPROVED' } });
    await h.prisma.medicineBatch.update({ where: { id: batch.id }, data: { currentCustodianId: pharmacy.id } });

    const res = await request(h.app).get(`/api/verify/${batch.publicId}`);
    expect(res.body.result).toBe('SUSPICIOUS');
    expect(res.body.chain.consistent).toBe(false);
    expect(res.body.chain.problems.join(' ')).toMatch(/On-chain custodian differs/);
  });
});
