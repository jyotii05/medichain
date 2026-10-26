-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('REGULATOR', 'MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('REGULATOR', 'MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'RECALLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('REGISTERED', 'TRANSFER_INITIATED', 'TRANSFER_ACCEPTED', 'TRANSFER_REJECTED', 'TRANSFER_CANCELLED', 'RECALLED', 'BLOCKED', 'FLAGGED', 'FLAG_RESOLVED', 'DISPENSED');

-- CreateEnum
CREATE TYPE "RecallAction" AS ENUM ('RECALL', 'BLOCK');

-- CreateEnum
CREATE TYPE "RecallClass" AS ENUM ('CLASS_I', 'CLASS_II', 'CLASS_III');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('VERIFIED', 'SUSPICIOUS', 'UNKNOWN', 'RECALLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('PUBLIC', 'PARTNER');

-- CreateEnum
CREATE TYPE "ChainMode" AS ENUM ('SIMULATION', 'ONCHAIN');

-- CreateEnum
CREATE TYPE "ChainTxStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChainOperation" AS ENUM ('REGISTER_ORGANIZATION', 'SET_ORGANIZATION_STATUS', 'REGISTER_BATCH', 'INITIATE_TRANSFER', 'ACCEPT_TRANSFER', 'REJECT_TRANSFER', 'RECALL_BATCH', 'LOG_EVENT');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'PENDING',
    "licenseNumber" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "country" TEXT,
    "chainRef" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medicine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "dosageForm" TEXT,
    "strength" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "packagingRef" TEXT,
    "manufacturerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineBatch" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "manufacturerId" TEXT NOT NULL,
    "manufacturerLicense" TEXT NOT NULL,
    "manufactureDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quantityOnHand" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "storageConditions" TEXT NOT NULL,
    "notes" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentCustodianId" TEXT NOT NULL,
    "registeredById" TEXT NOT NULL,
    "chainRef" TEXT NOT NULL,
    "dataHash" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicineBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustodyTransfer" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fromOrgId" TEXT NOT NULL,
    "toOrgId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "responseNote" TEXT,
    "initiatedById" TEXT NOT NULL,
    "respondedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "CustodyTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyChainEvent" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "EventType" NOT NULL,
    "actorUserId" TEXT,
    "actorOrgId" TEXT,
    "fromOrgId" TEXT,
    "toOrgId" TEXT,
    "transferId" TEXT,
    "recallId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallRecord" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "action" "RecallAction" NOT NULL DEFAULT 'RECALL',
    "classification" "RecallClass" NOT NULL,
    "reason" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchFlag" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "BatchFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationAttempt" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "queriedId" TEXT NOT NULL,
    "result" "VerificationResult" NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "channel" "VerificationChannel" NOT NULL DEFAULT 'PUBLIC',
    "userId" TEXT,
    "clientHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockchainTransaction" (
    "id" TEXT NOT NULL,
    "mode" "ChainMode" NOT NULL,
    "operation" "ChainOperation" NOT NULL,
    "status" "ChainTxStatus" NOT NULL DEFAULT 'PENDING',
    "batchId" TEXT,
    "eventId" TEXT,
    "organizationId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "txHash" TEXT,
    "blockNumber" INTEGER,
    "chainId" INTEGER,
    "contractAddress" TEXT,
    "simulatedRef" TEXT,
    "ledgerSequence" INTEGER,
    "prevLedgerHash" TEXT,
    "ledgerHash" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "BlockchainTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorOrgId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "clientHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_licenseNumber_key" ON "Organization"("licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_chainRef_key" ON "Organization"("chainRef");

-- CreateIndex
CREATE INDEX "Organization_type_status_idx" ON "Organization"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_userId_key" ON "OrganizationMembership"("userId");

-- CreateIndex
CREATE INDEX "OrganizationMembership_organizationId_idx" ON "OrganizationMembership"("organizationId");

-- CreateIndex
CREATE INDEX "Medicine_name_idx" ON "Medicine"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Medicine_manufacturerId_name_genericName_strength_key" ON "Medicine"("manufacturerId", "name", "genericName", "strength");

-- CreateIndex
CREATE UNIQUE INDEX "MedicineBatch_publicId_key" ON "MedicineBatch"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicineBatch_chainRef_key" ON "MedicineBatch"("chainRef");

-- CreateIndex
CREATE INDEX "MedicineBatch_currentCustodianId_idx" ON "MedicineBatch"("currentCustodianId");

-- CreateIndex
CREATE INDEX "MedicineBatch_status_idx" ON "MedicineBatch"("status");

-- CreateIndex
CREATE INDEX "MedicineBatch_expiryDate_idx" ON "MedicineBatch"("expiryDate");

-- CreateIndex
CREATE INDEX "MedicineBatch_createdAt_idx" ON "MedicineBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MedicineBatch_manufacturerId_batchNumber_key" ON "MedicineBatch"("manufacturerId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustodyTransfer_reference_key" ON "CustodyTransfer"("reference");

-- CreateIndex
CREATE INDEX "CustodyTransfer_batchId_status_idx" ON "CustodyTransfer"("batchId", "status");

-- CreateIndex
CREATE INDEX "CustodyTransfer_toOrgId_status_idx" ON "CustodyTransfer"("toOrgId", "status");

-- CreateIndex
CREATE INDEX "CustodyTransfer_fromOrgId_status_idx" ON "CustodyTransfer"("fromOrgId", "status");

-- CreateIndex
CREATE INDEX "CustodyTransfer_createdAt_idx" ON "CustodyTransfer"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyChainEvent_hash_key" ON "SupplyChainEvent"("hash");

-- CreateIndex
CREATE INDEX "SupplyChainEvent_createdAt_idx" ON "SupplyChainEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SupplyChainEvent_type_idx" ON "SupplyChainEvent"("type");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyChainEvent_batchId_sequence_key" ON "SupplyChainEvent"("batchId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "RecallRecord_reference_key" ON "RecallRecord"("reference");

-- CreateIndex
CREATE INDEX "RecallRecord_createdAt_idx" ON "RecallRecord"("createdAt");

-- CreateIndex
CREATE INDEX "BatchFlag_status_idx" ON "BatchFlag"("status");

-- CreateIndex
CREATE INDEX "BatchFlag_batchId_idx" ON "BatchFlag"("batchId");

-- CreateIndex
CREATE INDEX "VerificationAttempt_batchId_createdAt_idx" ON "VerificationAttempt"("batchId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationAttempt_result_createdAt_idx" ON "VerificationAttempt"("result", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationAttempt_createdAt_idx" ON "VerificationAttempt"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainTransaction_txHash_key" ON "BlockchainTransaction"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainTransaction_simulatedRef_key" ON "BlockchainTransaction"("simulatedRef");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainTransaction_ledgerSequence_key" ON "BlockchainTransaction"("ledgerSequence");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_status_createdAt_idx" ON "BlockchainTransaction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_batchId_idx" ON "BlockchainTransaction"("batchId");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_createdAt_idx" ON "BlockchainTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_currentCustodianId_fkey" FOREIGN KEY ("currentCustodianId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyTransfer" ADD CONSTRAINT "CustodyTransfer_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MedicineBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyTransfer" ADD CONSTRAINT "CustodyTransfer_fromOrgId_fkey" FOREIGN KEY ("fromOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyTransfer" ADD CONSTRAINT "CustodyTransfer_toOrgId_fkey" FOREIGN KEY ("toOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyTransfer" ADD CONSTRAINT "CustodyTransfer_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyTransfer" ADD CONSTRAINT "CustodyTransfer_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainEvent" ADD CONSTRAINT "SupplyChainEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MedicineBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainEvent" ADD CONSTRAINT "SupplyChainEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainEvent" ADD CONSTRAINT "SupplyChainEvent_actorOrgId_fkey" FOREIGN KEY ("actorOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainEvent" ADD CONSTRAINT "SupplyChainEvent_fromOrgId_fkey" FOREIGN KEY ("fromOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainEvent" ADD CONSTRAINT "SupplyChainEvent_toOrgId_fkey" FOREIGN KEY ("toOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainEvent" ADD CONSTRAINT "SupplyChainEvent_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "CustodyTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainEvent" ADD CONSTRAINT "SupplyChainEvent_recallId_fkey" FOREIGN KEY ("recallId") REFERENCES "RecallRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallRecord" ADD CONSTRAINT "RecallRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MedicineBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallRecord" ADD CONSTRAINT "RecallRecord_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchFlag" ADD CONSTRAINT "BatchFlag_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MedicineBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchFlag" ADD CONSTRAINT "BatchFlag_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchFlag" ADD CONSTRAINT "BatchFlag_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchFlag" ADD CONSTRAINT "BatchFlag_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MedicineBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockchainTransaction" ADD CONSTRAINT "BlockchainTransaction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MedicineBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockchainTransaction" ADD CONSTRAINT "BlockchainTransaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SupplyChainEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorOrgId_fkey" FOREIGN KEY ("actorOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Business-rule guarantees enforced by the database itself (hand-written)
-- ---------------------------------------------------------------------------

-- At most one PENDING custody transfer per batch (prevents conflicting concurrent transfers).
CREATE UNIQUE INDEX "CustodyTransfer_one_pending_per_batch" ON "CustodyTransfer"("batchId") WHERE "status" = 'PENDING';

-- Quantities can never become negative and stock can never exceed what was produced.
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_on_hand_range" CHECK ("quantityOnHand" >= 0 AND "quantityOnHand" <= "quantity");
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_dates_valid" CHECK ("expiryDate" > "manufactureDate");
ALTER TABLE "CustodyTransfer" ADD CONSTRAINT "CustodyTransfer_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "CustodyTransfer" ADD CONSTRAINT "CustodyTransfer_distinct_parties" CHECK ("fromOrgId" <> "toOrgId");

-- Supply-chain events and audit logs are append-only: UPDATE and DELETE are rejected.
CREATE OR REPLACE FUNCTION medichain_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyChainEvent_append_only" BEFORE UPDATE OR DELETE ON "SupplyChainEvent"
  FOR EACH ROW EXECUTE FUNCTION medichain_reject_mutation();
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION medichain_reject_mutation();
