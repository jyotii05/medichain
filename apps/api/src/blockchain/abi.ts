/**
 * Human-readable ABI for packages/contracts/contracts/MediChainRegistry.sol.
 * Kept in source so the API does not depend on build artefacts; it must stay in sync with the contract.
 */
export const MEDICHAIN_REGISTRY_ABI = [
  'function REGULATOR_ROLE() view returns (bytes32)',
  'function RECORDER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function registerOrganization(bytes32 orgRef, uint8 role)',
  'function setOrganizationActive(bytes32 orgRef, bool active)',
  'function registerBatch(bytes32 batchRef, bytes32 manufacturerRef, bytes32 dataHash, bytes32 eventHash)',
  'function initiateTransfer(bytes32 batchRef, bytes32 fromRef, bytes32 toRef, bytes32 eventHash)',
  'function acceptTransfer(bytes32 batchRef, bytes32 toRef, bytes32 eventHash)',
  'function rejectTransfer(bytes32 batchRef, bytes32 toRef, bytes32 eventHash)',
  'function recallBatch(bytes32 batchRef, bytes32 reasonHash, bytes32 eventHash)',
  'function getBatch(bytes32 batchRef) view returns (tuple(bytes32 manufacturer, bytes32 custodian, bytes32 pendingRecipient, uint8 status, bytes32 dataHash, bytes32 lastEventHash, uint64 registeredAt, uint32 eventCount))',
  'function getOrganization(bytes32 orgRef) view returns (tuple(uint8 role, bool active))',
  'function isRegistered(bytes32 batchRef) view returns (bool)',
  'event OrganizationRegistered(bytes32 indexed orgRef, uint8 role)',
  'event OrganizationStatusChanged(bytes32 indexed orgRef, bool active)',
  'event BatchRegistered(bytes32 indexed batchRef, bytes32 indexed manufacturerRef, bytes32 dataHash, bytes32 eventHash)',
  'event TransferInitiated(bytes32 indexed batchRef, bytes32 indexed fromRef, bytes32 indexed toRef, bytes32 eventHash)',
  'event TransferAccepted(bytes32 indexed batchRef, bytes32 indexed fromRef, bytes32 indexed toRef, bytes32 eventHash)',
  'event TransferRejected(bytes32 indexed batchRef, bytes32 indexed fromRef, bytes32 indexed toRef, bytes32 eventHash)',
  'event BatchRecalled(bytes32 indexed batchRef, bytes32 reasonHash, bytes32 eventHash)',
  'error InvalidReference()',
  'error InvalidRole()',
  'error OrganizationAlreadyRegistered(bytes32 orgRef)',
  'error OrganizationNotRegistered(bytes32 orgRef)',
  'error OrganizationNotAuthorized(bytes32 orgRef)',
  'error BatchAlreadyRegistered(bytes32 batchRef)',
  'error BatchNotRegistered(bytes32 batchRef)',
  'error BatchIsRecalled(bytes32 batchRef)',
  'error NotCurrentCustodian(bytes32 orgRef)',
  'error TransferAlreadyPending(bytes32 batchRef)',
  'error NoPendingTransfer(bytes32 batchRef)',
  'error NotPendingRecipient(bytes32 orgRef)',
  'error InvalidTransferRoute(uint8 fromRole, uint8 toRole)',
  'error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)',
] as const;

/** Solidity enum OrgRole { None, Manufacturer, Distributor, Wholesaler, Pharmacy } */
export const ORG_ROLE_ON_CHAIN = {
  MANUFACTURER: 1,
  DISTRIBUTOR: 2,
  WHOLESALER: 3,
  PHARMACY: 4,
} as const;

/** Solidity enum BatchStatus { None, Active, Recalled } */
export const BATCH_STATUS_ON_CHAIN = ['NONE', 'ACTIVE', 'RECALLED'] as const;
