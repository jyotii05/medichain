import { Contract, JsonRpcProvider, Wallet, isAddress, type ContractTransactionResponse } from 'ethers';
import type { Organization } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { MEDICHAIN_REGISTRY_ABI, ORG_ROLE_ON_CHAIN, BATCH_STATUS_ON_CHAIN } from './abi.js';

/**
 * ONCHAIN MODE — the API acts as an authorised relayer (RECORDER_ROLE / REGULATOR_ROLE) and writes
 * minimal references to the MediChainRegistry contract: opaque keccak256 batch/org references and
 * SHA-256 hashes of off-chain events. No names, quantities or personal data are sent on-chain.
 *
 * Writes are performed after the database transaction commits, strictly in creation order through a
 * single in-process queue, because the contract enforces the same state machine as the API.
 */

const RPC_TIMEOUT_MS = 5000;
const RECEIPT_TIMEOUT_MS = 60_000;

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

let provider: JsonRpcProvider | null = null;
let wallet: Wallet | null = null;
let contract: Contract | null = null;

export function onchainConfigProblem(): string | null {
  if (!env.CONTRACT_ADDRESS) return 'CONTRACT_ADDRESS is not set — deploy the contract and configure apps/api/.env';
  if (!isAddress(env.CONTRACT_ADDRESS)) return 'CONTRACT_ADDRESS is not a valid address';
  if (!env.RELAYER_PRIVATE_KEY) return 'RELAYER_PRIVATE_KEY is not set';
  return null;
}

export function getContract(): Contract | null {
  if (onchainConfigProblem()) return null;
  if (!contract) {
    // cacheTimeout -1: ethers caches identical RPC calls for 250 ms by default, which can hand out the
    // same 'pending' nonce to back-to-back transactions. Writes are serialised, so fresh reads are safe.
    provider = new JsonRpcProvider(env.CHAIN_RPC_URL, undefined, { cacheTimeout: -1, polling: true, pollingInterval: 1000 });
    wallet = new Wallet(env.RELAYER_PRIVATE_KEY, provider);
    contract = new Contract(env.CONTRACT_ADDRESS, MEDICHAIN_REGISTRY_ABI, wallet);
  }
  return contract;
}

export interface OnchainStatus {
  connected: boolean;
  message: string;
  chainId?: number;
  networkName?: string;
  blockNumber?: number;
  contractAddress?: string;
  relayerAddress?: string;
  relayerHasRoles?: boolean;
}

export async function onchainStatus(): Promise<OnchainStatus> {
  const problem = onchainConfigProblem();
  if (problem) return { connected: false, message: problem };
  const c = getContract()!;
  try {
    const [network, blockNumber, code] = await withTimeout(
      Promise.all([provider!.getNetwork(), provider!.getBlockNumber(), provider!.getCode(env.CONTRACT_ADDRESS)]),
      RPC_TIMEOUT_MS,
      'RPC request',
    );
    if (code === '0x') {
      return {
        connected: false,
        message: `No contract is deployed at ${env.CONTRACT_ADDRESS} on this network. Re-run the deployment script.`,
        chainId: Number(network.chainId),
        blockNumber,
      };
    }
    const [recorderRole, regulatorRole] = await Promise.all([c.RECORDER_ROLE(), c.REGULATOR_ROLE()]);
    const [hasRecorder, hasRegulator] = await Promise.all([
      c.hasRole(recorderRole, wallet!.address),
      c.hasRole(regulatorRole, wallet!.address),
    ]);
    return {
      connected: true,
      message: hasRecorder && hasRegulator ? 'Connected to MediChainRegistry' : 'Connected, but the relayer account lacks the required roles',
      chainId: Number(network.chainId),
      networkName: network.name,
      blockNumber,
      contractAddress: env.CONTRACT_ADDRESS,
      relayerAddress: wallet!.address,
      relayerHasRoles: hasRecorder && hasRegulator,
    };
  } catch (e) {
    return { connected: false, message: `Blockchain node unreachable at ${env.CHAIN_RPC_URL}: ${shortError(e)}` };
  }
}

export function shortError(e: unknown): string {
  const err = e as { revert?: { name?: string; args?: unknown[] }; shortMessage?: string; message?: string; data?: string };
  if (err?.revert?.name) return `Contract reverted: ${err.revert.name}`;
  if (err?.data && contract) {
    try {
      const parsed = contract.interface.parseError(err.data);
      if (parsed) return `Contract reverted: ${parsed.name}`;
    } catch {
      /* ignore */
    }
  }
  return (err?.shortMessage ?? err?.message ?? String(e)).slice(0, 300);
}

/** Makes sure the organization exists on-chain with the right role and active flag. */
async function ensureOrganization(org: Organization) {
  const c = getContract()!;
  const role = ORG_ROLE_ON_CHAIN[org.type as keyof typeof ORG_ROLE_ON_CHAIN];
  if (!role) return; // regulators are not supply-chain parties on-chain
  const current = await c.getOrganization(org.chainRef);
  const wantActive = org.status === 'APPROVED';
  if (Number(current.role) === 0) {
    const sent: ContractTransactionResponse = await c.registerOrganization(org.chainRef, role);
    const r = await withTimeout(sent.wait(), RECEIPT_TIMEOUT_MS, 'Transaction receipt');
    await recordAdminTx('REGISTER_ORGANIZATION', org, sent.hash, r?.blockNumber ?? null);
    if (!wantActive) await setActive(org, false);
  } else if (Boolean(current.active) !== wantActive) {
    await setActive(org, wantActive);
  }
}

async function setActive(org: Organization, active: boolean) {
  const c = getContract()!;
  const sent: ContractTransactionResponse = await c.setOrganizationActive(org.chainRef, active);
  const r = await withTimeout(sent.wait(), RECEIPT_TIMEOUT_MS, 'Transaction receipt');
  await recordAdminTx('SET_ORGANIZATION_STATUS', org, sent.hash, r?.blockNumber ?? null);
}

async function recordAdminTx(operation: 'REGISTER_ORGANIZATION' | 'SET_ORGANIZATION_STATUS', org: Organization, txHash: string, blockNumber: number | null) {
  const network = await provider!.getNetwork();
  await prisma.blockchainTransaction.create({
    data: {
      mode: 'ONCHAIN',
      operation,
      status: 'CONFIRMED',
      organizationId: org.id,
      payloadHash: org.chainRef,
      txHash,
      blockNumber,
      chainId: Number(network.chainId),
      contractAddress: env.CONTRACT_ADDRESS,
      attempts: 1,
      confirmedAt: new Date(),
    },
  });
}

/** Sends one pending BlockchainTransaction row to the contract. */
async function processOne(id: string) {
  const row = await prisma.blockchainTransaction.findUnique({
    where: { id },
    include: {
      batch: { include: { manufacturer: true } },
      event: { include: { fromOrg: true, toOrg: true } },
    },
  });
  if (!row || row.status !== 'PENDING' || !row.batch || !row.event) return;
  const c = getContract();
  if (!c) {
    await prisma.blockchainTransaction.update({ where: { id }, data: { status: 'FAILED', error: onchainConfigProblem(), attempts: { increment: 1 } } });
    return;
  }
  const { batch, event } = row;
  try {
    let sent: ContractTransactionResponse;
    switch (row.operation) {
      case 'REGISTER_BATCH':
        await ensureOrganization(batch.manufacturer);
        sent = await c.registerBatch(batch.chainRef, batch.manufacturer.chainRef, batch.dataHash, event.hash);
        break;
      case 'INITIATE_TRANSFER':
        await ensureOrganization(event.fromOrg!);
        await ensureOrganization(event.toOrg!);
        sent = await c.initiateTransfer(batch.chainRef, event.fromOrg!.chainRef, event.toOrg!.chainRef, event.hash);
        break;
      case 'ACCEPT_TRANSFER':
        sent = await c.acceptTransfer(batch.chainRef, event.toOrg!.chainRef, event.hash);
        break;
      case 'REJECT_TRANSFER':
        sent = await c.rejectTransfer(batch.chainRef, event.toOrg!.chainRef, event.hash);
        break;
      case 'RECALL_BATCH': {
        const reasonHash = (event.data as { reasonHash?: string })?.reasonHash;
        if (!reasonHash) throw new Error('Recall event has no reasonHash');
        sent = await c.recallBatch(batch.chainRef, reasonHash, event.hash);
        break;
      }
      default:
        throw new Error(`Operation ${row.operation} is not supported on-chain`);
    }
    await prisma.blockchainTransaction.update({ where: { id }, data: { txHash: sent.hash, attempts: { increment: 1 } } });
    const receipt = await withTimeout(sent.wait(), RECEIPT_TIMEOUT_MS, 'Transaction receipt');
    const network = await provider!.getNetwork();
    await prisma.blockchainTransaction.update({
      where: { id },
      data: {
        status: receipt?.status === 1 ? 'CONFIRMED' : 'FAILED',
        blockNumber: receipt?.blockNumber ?? null,
        chainId: Number(network.chainId),
        contractAddress: env.CONTRACT_ADDRESS,
        confirmedAt: receipt?.status === 1 ? new Date() : null,
        error: receipt?.status === 1 ? null : 'Transaction reverted',
      },
    });
  } catch (e) {
    await prisma.blockchainTransaction.update({
      where: { id },
      data: { status: 'FAILED', error: shortError(e), attempts: { increment: 1 } },
    });
    if (!env.isTest) console.warn(`[blockchain] ${row.operation} for ${batch.publicId} failed: ${shortError(e)}`);
  }
}

let running = false;
let rerun = false;
const orgSyncQueue = new Set<string>();

/** Queue an organization role/active-flag sync (e.g. after approval or suspension). */
export function queueOrganizationSync(organizationId: string) {
  if (onchainConfigProblem()) return;
  orgSyncQueue.add(organizationId);
  void dispatchPending().catch((e) => console.error('[blockchain] dispatch failed', e));
}

/**
 * Processes all PENDING on-chain rows in creation order. Re-entrant calls while a run is in progress
 * schedule one more pass instead of running concurrently (nonce and state-order safety).
 */
let currentRun: Promise<void> | null = null;

export function dispatchPending(): Promise<void> {
  if (running && currentRun) {
    rerun = true;
    return currentRun; // callers awaiting this see the queued work (including the re-run) complete
  }
  currentRun = runDispatch();
  return currentRun;
}

async function runDispatch(): Promise<void> {
  running = true;
  try {
    do {
      rerun = false;
      for (const orgId of [...orgSyncQueue]) {
        orgSyncQueue.delete(orgId);
        const org = await prisma.organization.findUnique({ where: { id: orgId } });
        if (!org || !getContract()) continue;
        try {
          await ensureOrganization(org);
        } catch (e) {
          if (!env.isTest) console.warn(`[blockchain] organization sync for ${org.name} failed: ${shortError(e)}`);
        }
      }
      const pending = await prisma.blockchainTransaction.findMany({
        where: { mode: 'ONCHAIN', status: 'PENDING', eventId: { not: null } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, batchId: true },
      });
      // Keep per-batch ordering: a batch with an unresolved FAILED write is held back entirely until a
      // regulator re-queues it (POST /api/blockchain/retry), otherwise later ops would revert on-chain.
      const failedRows = await prisma.blockchainTransaction.findMany({
        where: { mode: 'ONCHAIN', status: 'FAILED', batchId: { not: null } },
        select: { batchId: true },
        distinct: ['batchId'],
      });
      const failedBatches = new Set<string>(failedRows.map((r) => r.batchId!));
      for (const p of pending) {
        if (p.batchId && failedBatches.has(p.batchId)) continue;
        await processOne(p.id);
        const after = await prisma.blockchainTransaction.findUnique({ where: { id: p.id }, select: { status: true } });
        if (after?.status === 'FAILED' && p.batchId) failedBatches.add(p.batchId);
      }
    } while (rerun);
  } finally {
    running = false;
    currentRun = null;
  }
}

export interface OnchainBatchState {
  registered: boolean;
  custodian: string;
  pendingRecipient: string;
  status: (typeof BATCH_STATUS_ON_CHAIN)[number];
  dataHash: string;
  lastEventHash: string;
  eventCount: number;
  registeredAt: number;
}

export async function readBatch(batchRef: string): Promise<OnchainBatchState> {
  const c = getContract();
  if (!c) throw new Error(onchainConfigProblem() ?? 'Contract unavailable');
  const b = await withTimeout(c.getBatch(batchRef), RPC_TIMEOUT_MS, 'Contract read');
  const status = BATCH_STATUS_ON_CHAIN[Number(b.status)] ?? 'NONE';
  return {
    registered: status !== 'NONE',
    custodian: b.custodian,
    pendingRecipient: b.pendingRecipient,
    status,
    dataHash: b.dataHash,
    lastEventHash: b.lastEventHash,
    eventCount: Number(b.eventCount),
    registeredAt: Number(b.registeredAt),
  };
}

export interface TxLogCheck {
  found: boolean;
  matches: boolean;
  eventName?: string;
  blockNumber?: number;
  message: string;
}

/** Fetches the receipt for a transaction and checks it emitted a contract event carrying `expectedHash`. */
export async function verifyTransactionLog(txHash: string, expectedHash: string): Promise<TxLogCheck> {
  const c = getContract();
  if (!c || !provider) return { found: false, matches: false, message: onchainConfigProblem() ?? 'Contract unavailable' };
  const receipt = await withTimeout(provider.getTransactionReceipt(txHash), RPC_TIMEOUT_MS, 'Receipt lookup');
  if (!receipt) return { found: false, matches: false, message: 'Transaction not found on the connected network' };
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== env.CONTRACT_ADDRESS.toLowerCase()) continue;
    const parsed = c.interface.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed) continue;
    const args = parsed.args as unknown as Record<string, unknown>;
    const hash = (args.eventHash ?? args.orgRef) as string | undefined;
    if (hash && hash.toLowerCase() === expectedHash.toLowerCase()) {
      return { found: true, matches: true, eventName: parsed.name, blockNumber: receipt.blockNumber, message: `${parsed.name} event in block ${receipt.blockNumber} carries the expected hash` };
    }
  }
  return { found: true, matches: false, blockNumber: receipt.blockNumber, message: 'Transaction found, but no contract event carries the expected hash' };
}
