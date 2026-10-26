/** Response types for the MediChain REST API (see docs/openapi.yaml). */

export type Role = 'REGULATOR' | 'MANUFACTURER' | 'DISTRIBUTOR' | 'WHOLESALER' | 'PHARMACY';
export type OrgType = Role;
export type OrgStatus = 'PENDING' | 'APPROVED' | 'SUSPENDED';
export type BatchStatus = 'ACTIVE' | 'RECALLED' | 'BLOCKED';
export type DisplayStatus = 'ACTIVE' | 'IN_TRANSIT' | 'RECALLED' | 'BLOCKED' | 'EXPIRED';
export type TransferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
export type VerificationResultType = 'VERIFIED' | 'SUSPICIOUS' | 'UNKNOWN' | 'RECALLED' | 'EXPIRED';
export type ChainMode = 'SIMULATION' | 'ONCHAIN';
export type ChainTxStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';
export type Severity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
export type EventType =
  | 'REGISTERED'
  | 'TRANSFER_INITIATED'
  | 'TRANSFER_ACCEPTED'
  | 'TRANSFER_REJECTED'
  | 'TRANSFER_CANCELLED'
  | 'RECALLED'
  | 'BLOCKED'
  | 'FLAGGED'
  | 'FLAG_RESOLVED'
  | 'DISPENSED';

/** Body of POST /api/auth/register. Regulator accounts cannot be self-registered. */
export interface RegistrationInput {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  jobTitle?: string;
  organization: {
    name: string;
    type: Exclude<OrgType, 'REGULATOR'>;
    licenseNumber: string;
    phone?: string;
    city?: string;
    country?: string;
  };
  acceptTerms: true;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  title: string | null;
  lastLoginAt: string | null;
  isDemo: boolean;
  organization: { id: string; name: string; type: OrgType; status: OrgStatus; licenseNumber: string; city: string | null; country: string | null };
}

export interface OrgRef {
  id: string;
  name: string;
  type: OrgType;
  status: OrgStatus;
  city: string | null;
  country: string | null;
}

export interface BatchRow {
  id: string;
  publicId: string;
  batchNumber: string;
  medicine: { id: string; name: string; genericName: string; category: string; strength: string; dosageForm: string | null };
  manufacturer: OrgRef;
  currentCustodian: OrgRef;
  manufactureDate: string;
  expiryDate: string;
  quantity: number;
  quantityOnHand: number;
  unit: string;
  status: BatchStatus;
  displayStatus: DisplayStatus;
  hasPendingTransfer: boolean;
  isDemo: boolean;
  createdAt: string;
}

export interface TransferRow {
  id: string;
  reference: string;
  status: TransferStatus;
  quantity: number;
  notes: string | null;
  responseNote: string | null;
  createdAt: string;
  respondedAt: string | null;
  fromOrg: OrgRef;
  toOrg: OrgRef;
  initiatedBy: string | null;
  respondedBy: string | null;
  batch: { id: string; publicId: string; batchNumber: string; medicineName: string; strength: string; unit: string; expiryDate: string; status: BatchStatus };
}

export interface Check {
  key: string;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'info';
  detail: string;
}

export interface ChainCheck {
  mode: ChainMode;
  available: boolean;
  consistent: boolean | null;
  summary: string;
  problems: string[];
  notes: string[];
  anchored: number;
  pending: number;
  failed: number;
  latest?: { reference: string; kind: 'TX_HASH' | 'SIMULATED_REF'; blockNumber?: number | null; confirmedAt?: string | null; logCheck?: string };
}

export type StageStatus = 'completed' | 'current' | 'in_transit' | 'rejected' | 'cancelled' | 'missing' | 'unrecorded' | 'upcoming';

export interface JourneyStage {
  key: string;
  role: OrgType;
  status: StageStatus;
  org: { id?: string; name: string; city: string | null; country: string | null } | null;
  shipmentRef: string | null;
  initiatedAt: string | null;
  completedAt: string | null;
  eventId: string | null;
  eventHash: string | null;
  anchor: { kind: 'TX_HASH' | 'SIMULATED_REF'; reference: string | null; status: ChainTxStatus; blockNumber: number | null } | null;
  note: string | null;
}

export interface EventRow {
  id?: string;
  sequence: number;
  type: EventType;
  createdAt: string;
  actorOrg: { name: string; type: OrgType } | null;
  fromOrg: { name: string; type: OrgType } | null;
  toOrg: { name: string; type: OrgType } | null;
  data: Record<string, unknown>;
  hash: string;
  prevHash: string;
  anchor: { mode: ChainMode; status: ChainTxStatus; txHash: string | null; blockNumber: number | null; simulatedRef: string | null } | null;
}

export interface RecallRecord {
  id: string;
  reference: string;
  action: 'RECALL' | 'BLOCK';
  classification: 'CLASS_I' | 'CLASS_II' | 'CLASS_III';
  reason: string;
  createdAt: string;
}

export interface FlagRow {
  id: string;
  reason: string;
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  org: OrgRef;
  raisedBy: string;
  resolvedBy?: string | null;
  batch?: { id: string; publicId: string; batchNumber: string; medicineName: string; status: BatchStatus };
}

export interface BatchDetail {
  batch: BatchRow & {
    manufacturerLicense: string;
    storageConditions: string;
    notes: string | null;
    medicine: BatchRow['medicine'] & { description: string | null; packagingRef: string | null };
    chainRef: string;
    dataHash: string;
    verificationUrl: string;
  };
  assessment: { result: VerificationResultType; headline: string; reasons: string[]; checks: Check[]; chain: ChainCheck | null };
  journey: JourneyStage[];
  events: EventRow[];
  transfers: TransferRow[];
  recalls: RecallRecord[];
  flags: FlagRow[];
  permissions: { canTransfer: boolean; canDispense: boolean; canFlag: boolean; canRecall: boolean };
}

export interface VerificationResponse {
  result: VerificationResultType;
  headline: string;
  reasons: string[];
  queriedId: string;
  verifiedAt: string;
  disclaimer: string;
  checks?: Check[];
  batch: null | {
    publicId: string;
    batchNumber: string;
    medicine: { name: string; genericName: string; strength: string; dosageForm: string | null; category: string };
    manufacturer: { name: string; country: string | null };
    manufactureDate: string;
    expiryDate: string;
    storageConditions: string;
    status: BatchStatus;
    displayStatus: DisplayStatus;
    currentCustodian: { name: string; type: OrgType; city: string | null };
  };
  recall?: null | { reference: string; action: 'RECALL' | 'BLOCK'; classification: string; reason: string; createdAt: string };
  journey?: JourneyStage[];
  events?: EventRow[];
  chain?: ChainCheck | null;
}

export interface ChainTx {
  id: string;
  mode: ChainMode;
  operation: string;
  status: ChainTxStatus;
  payloadHash: string;
  eventId: string | null;
  batch: { id: string; publicId: string; batchNumber: string } | null;
  txHash: string | null;
  blockNumber: number | null;
  chainId: number | null;
  contractAddress: string | null;
  simulatedRef: string | null;
  ledgerSequence: number | null;
  ledgerHash: string | null;
  prevLedgerHash: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ChainStatus {
  mode: ChainMode;
  connected: boolean;
  label: string;
  message: string;
  totals: { confirmed: number; pending: number; failed: number };
  ledger?: { entries: number; lastSequence: number; intact: boolean; problems: string[] };
  network?: { chainId?: number; name?: string; blockNumber?: number };
  contractAddress?: string;
  relayerAddress?: string;
  relayerHasRoles?: boolean;
  rpcUrl?: string;
}

export interface NotificationRow {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface DashboardData {
  role: Role;
  stats: {
    totalBatches: number;
    activeBatches: number;
    inTransit: number;
    pendingTransfers: number;
    pendingIncoming: number;
    pendingOutgoing: number;
    recalledBatches: number;
    expiredBatches: number;
    expiringSoon: number;
    suspiciousVerifications: number;
    openFlags: number;
    pendingOrganizations: number;
    inCustody: number;
  };
  statusDistribution: { status: DisplayStatus; count: number }[];
  activity: { date: string; registrations: number; shipments: number; deliveries: number; recalls: number; verifications: number }[];
  recentBatches: BatchRow[];
  recentTransfers: TransferRow[];
  pendingApprovals: TransferRow[];
  alerts: NotificationRow[];
  chain: { mode: ChainMode; recent: ChainTx[] };
  onboarding: { systemIsEmpty: boolean; demoSeedEnabled: boolean };
}

export interface OrganizationRow {
  id: string;
  name: string;
  type: OrgType;
  status: OrgStatus;
  licenseNumber: string;
  city: string | null;
  country: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine?: string | null;
  approvedAt: string | null;
  createdAt: string;
  isDemo: boolean;
  counts?: { members: number; manufactured: number; inCustody: number };
}

export interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  title: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  isDemo: boolean;
  organization: { id: string; name: string; type: OrgType } | null;
}

export interface RecallRow extends RecallRecord {
  initiatedBy: string;
  batch: {
    id: string;
    publicId: string;
    batchNumber: string;
    medicineName: string;
    strength: string;
    quantity: number;
    unit: string;
    manufacturer: OrgRef;
    currentCustodian: OrgRef;
  };
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: { name: string; email: string } | null;
  organization: string | null;
}

export interface ReportData {
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
