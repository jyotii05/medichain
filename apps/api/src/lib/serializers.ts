import type { BlockchainTransaction, CustodyTransfer, Medicine, MedicineBatch, Organization } from '@prisma/client';
import { displayStatus } from '../services/batches.js';
import type { Assessment } from '../services/assessment.js';

export const orgRef = (o: Organization | null | undefined) =>
  o ? { id: o.id, name: o.name, type: o.type, status: o.status, city: o.city, country: o.country } : null;

const day = (d: Date) => d.toISOString().slice(0, 10);

export function batchRow(
  b: MedicineBatch & { medicine: Medicine; manufacturer: Organization; currentCustodian: Organization; transfers?: CustodyTransfer[] },
) {
  const pending = (b.transfers ?? []).some((t) => t.status === 'PENDING');
  return {
    id: b.id,
    publicId: b.publicId,
    batchNumber: b.batchNumber,
    medicine: {
      id: b.medicine.id,
      name: b.medicine.name,
      genericName: b.medicine.genericName,
      category: b.medicine.category,
      strength: b.medicine.strength,
      dosageForm: b.medicine.dosageForm,
    },
    manufacturer: orgRef(b.manufacturer),
    currentCustodian: orgRef(b.currentCustodian),
    manufactureDate: day(b.manufactureDate),
    expiryDate: day(b.expiryDate),
    quantity: b.quantity,
    quantityOnHand: b.quantityOnHand,
    unit: b.unit,
    status: b.status,
    displayStatus: displayStatus(b, pending),
    hasPendingTransfer: pending,
    isDemo: b.isDemo,
    createdAt: b.createdAt,
  };
}

export function transferRow(
  t: CustodyTransfer & {
    fromOrg: Organization;
    toOrg: Organization;
    batch: MedicineBatch & { medicine: Medicine };
    initiatedBy?: { fullName: string } | null;
    respondedBy?: { fullName: string } | null;
  },
) {
  return {
    id: t.id,
    reference: t.reference,
    status: t.status,
    quantity: t.quantity,
    notes: t.notes,
    responseNote: t.responseNote,
    createdAt: t.createdAt,
    respondedAt: t.respondedAt,
    fromOrg: orgRef(t.fromOrg),
    toOrg: orgRef(t.toOrg),
    initiatedBy: t.initiatedBy?.fullName ?? null,
    respondedBy: t.respondedBy?.fullName ?? null,
    batch: {
      id: t.batch.id,
      publicId: t.batch.publicId,
      batchNumber: t.batch.batchNumber,
      medicineName: t.batch.medicine.name,
      strength: t.batch.medicine.strength,
      unit: t.batch.unit,
      expiryDate: day(t.batch.expiryDate),
      status: t.batch.status,
    },
  };
}

export function chainTxRow(t: BlockchainTransaction & { batch?: { publicId: string; batchNumber: string } | null }) {
  return {
    id: t.id,
    mode: t.mode,
    operation: t.operation,
    status: t.status,
    payloadHash: t.payloadHash,
    eventId: t.eventId,
    batch: t.batch ? { id: t.batchId, publicId: t.batch.publicId, batchNumber: t.batch.batchNumber } : null,
    // real chain fields — only ever populated in ONCHAIN mode
    txHash: t.txHash,
    blockNumber: t.blockNumber,
    chainId: t.chainId,
    contractAddress: t.contractAddress,
    // simulated ledger fields — only ever populated in SIMULATION mode
    simulatedRef: t.simulatedRef,
    ledgerSequence: t.ledgerSequence,
    ledgerHash: t.ledgerHash,
    prevLedgerHash: t.prevLedgerHash,
    error: t.error,
    attempts: t.attempts,
    createdAt: t.createdAt,
    confirmedAt: t.confirmedAt,
  };
}

const PUBLIC_DATA_KEYS = new Set(['reference', 'quantity', 'unit', 'batchNumber', 'classification', 'outcome', 'remaining', 'cause']);

/** Event timeline. `audience: 'public'` strips free-text notes and internal ids. */
export function eventRows(a: Assessment, audience: 'public' | 'partner') {
  return a.events.map((e) => {
    const anchor = a.anchors.get(e.id);
    const data = Object.fromEntries(
      Object.entries((e.data as Record<string, unknown>) ?? {}).filter(([k]) => audience === 'partner' || PUBLIC_DATA_KEYS.has(k)),
    );
    return {
      id: audience === 'partner' ? e.id : undefined,
      sequence: e.sequence,
      type: e.type,
      createdAt: e.createdAt,
      actorOrg: e.actorOrg ? { name: e.actorOrg.name, type: e.actorOrg.type } : null,
      fromOrg: e.fromOrg ? { name: e.fromOrg.name, type: e.fromOrg.type } : null,
      toOrg: e.toOrg ? { name: e.toOrg.name, type: e.toOrg.type } : null,
      data,
      hash: e.hash,
      prevHash: e.prevHash,
      anchor: anchor
        ? {
            mode: anchor.mode,
            status: anchor.status,
            txHash: anchor.txHash,
            blockNumber: anchor.blockNumber,
            simulatedRef: anchor.simulatedRef,
          }
        : null,
    };
  });
}
