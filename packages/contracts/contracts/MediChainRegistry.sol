// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MediChainRegistry
 * @notice Tamper-evident traceability registry for medicine batches moving through the
 *         supply chain Manufacturer -> Distributor -> Wholesaler -> Pharmacy.
 *
 * @dev PRIVACY: this contract stores ONLY opaque references (`bytes32` identifiers derived
 *      off-chain, e.g. keccak256 of an internal UUID) and hashes of off-chain records.
 *      It never stores personal data, patient data, prescriptions, prices, or any other
 *      confidential business information. The full records live in the off-chain database;
 *      the chain provides an immutable anchor so anyone can verify that an off-chain record
 *      (batch data or a supply-chain event) has not been altered since it was recorded.
 *
 * @dev RELAYER MODEL: supply-chain participants do not hold wallets. The off-chain MediChain
 *      API authenticates users and acts as an authorized relayer holding RECORDER_ROLE
 *      (batch registration and custody transfers). Regulator actions (organization
 *      registration/status and recalls) require REGULATOR_ROLE. The contract still enforces
 *      the business rules (custody, transfer routes, recall status) independently of the API.
 */
contract MediChainRegistry is AccessControl {
    /// @notice Role allowed to manage organizations and recall batches.
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");
    /// @notice Role allowed to record batch registrations and custody transfers (the API relayer).
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");

    /// @notice Supply-chain role of an organization. Values 0..4.
    enum OrgRole {
        None,
        Manufacturer,
        Distributor,
        Wholesaler,
        Pharmacy
    }

    /// @notice Lifecycle status of a batch. Values 0..2.
    enum BatchStatus {
        None,
        Active,
        Recalled
    }

    /// @notice On-chain view of an organization (identified by an opaque reference only).
    struct Organization {
        OrgRole role;
        bool active;
    }

    /// @notice On-chain anchor of a batch. Contains references and hashes only.
    struct Batch {
        bytes32 manufacturer; // orgRef of the manufacturer
        bytes32 custodian; // orgRef of the current recorded custodian
        bytes32 pendingRecipient; // orgRef, or bytes32(0) when no transfer is pending
        BatchStatus status;
        bytes32 dataHash; // hash of the off-chain batch record
        bytes32 lastEventHash; // hash of the latest off-chain supply-chain event
        uint64 registeredAt; // block.timestamp at registration
        uint32 eventCount; // number of recorded events
    }

    mapping(bytes32 => Organization) private _organizations;
    mapping(bytes32 => Batch) private _batches;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event OrganizationRegistered(bytes32 indexed orgRef, OrgRole role);
    event OrganizationStatusChanged(bytes32 indexed orgRef, bool active);
    event BatchRegistered(
        bytes32 indexed batchRef,
        bytes32 indexed manufacturerRef,
        bytes32 dataHash,
        bytes32 eventHash
    );
    event TransferInitiated(
        bytes32 indexed batchRef,
        bytes32 indexed fromRef,
        bytes32 indexed toRef,
        bytes32 eventHash
    );
    event TransferAccepted(
        bytes32 indexed batchRef,
        bytes32 indexed fromRef,
        bytes32 indexed toRef,
        bytes32 eventHash
    );
    event TransferRejected(
        bytes32 indexed batchRef,
        bytes32 indexed fromRef,
        bytes32 indexed toRef,
        bytes32 eventHash
    );
    event BatchRecalled(bytes32 indexed batchRef, bytes32 reasonHash, bytes32 eventHash);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidReference();
    error InvalidRole();
    error OrganizationAlreadyRegistered(bytes32 orgRef);
    error OrganizationNotRegistered(bytes32 orgRef);
    error OrganizationNotAuthorized(bytes32 orgRef);
    error BatchAlreadyRegistered(bytes32 batchRef);
    error BatchNotRegistered(bytes32 batchRef);
    error BatchIsRecalled(bytes32 batchRef);
    error NotCurrentCustodian(bytes32 orgRef);
    error TransferAlreadyPending(bytes32 batchRef);
    error NoPendingTransfer(bytes32 batchRef);
    error NotPendingRecipient(bytes32 orgRef);
    error InvalidTransferRoute(uint8 fromRole, uint8 toRole);

    /**
     * @param admin Account granted DEFAULT_ADMIN_ROLE, REGULATOR_ROLE and RECORDER_ROLE.
     */
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGULATOR_ROLE, admin);
        _grantRole(RECORDER_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Organization management (regulator)
    // ---------------------------------------------------------------------

    /// @notice Register an organization by opaque reference with a supply-chain role.
    function registerOrganization(bytes32 orgRef, OrgRole role) external onlyRole(REGULATOR_ROLE) {
        if (orgRef == bytes32(0)) revert InvalidReference();
        if (role == OrgRole.None) revert InvalidRole();
        if (_organizations[orgRef].role != OrgRole.None) revert OrganizationAlreadyRegistered(orgRef);

        _organizations[orgRef] = Organization({role: role, active: true});
        emit OrganizationRegistered(orgRef, role);
    }

    /// @notice Activate or deactivate a registered organization.
    function setOrganizationActive(bytes32 orgRef, bool active) external onlyRole(REGULATOR_ROLE) {
        Organization storage org = _organizations[orgRef];
        if (org.role == OrgRole.None) revert OrganizationNotRegistered(orgRef);

        org.active = active;
        emit OrganizationStatusChanged(orgRef, active);
    }

    // ---------------------------------------------------------------------
    // Batch lifecycle (recorder / regulator)
    // ---------------------------------------------------------------------

    /// @notice Anchor a newly manufactured batch. The manufacturer becomes the first custodian.
    function registerBatch(
        bytes32 batchRef,
        bytes32 manufacturerRef,
        bytes32 dataHash,
        bytes32 eventHash
    ) external onlyRole(RECORDER_ROLE) {
        if (batchRef == bytes32(0) || dataHash == bytes32(0) || eventHash == bytes32(0)) {
            revert InvalidReference();
        }
        if (_batches[batchRef].status != BatchStatus.None) revert BatchAlreadyRegistered(batchRef);

        Organization storage org = _organizations[manufacturerRef];
        if (!org.active || org.role != OrgRole.Manufacturer) {
            revert OrganizationNotAuthorized(manufacturerRef);
        }

        _batches[batchRef] = Batch({
            manufacturer: manufacturerRef,
            custodian: manufacturerRef,
            pendingRecipient: bytes32(0),
            status: BatchStatus.Active,
            dataHash: dataHash,
            lastEventHash: eventHash,
            registeredAt: uint64(block.timestamp),
            eventCount: 1
        });

        emit BatchRegistered(batchRef, manufacturerRef, dataHash, eventHash);
    }

    /// @notice Record that the current custodian has dispatched the batch to the next organization.
    function initiateTransfer(
        bytes32 batchRef,
        bytes32 fromRef,
        bytes32 toRef,
        bytes32 eventHash
    ) external onlyRole(RECORDER_ROLE) {
        if (eventHash == bytes32(0)) revert InvalidReference();
        Batch storage batch = _existingBatch(batchRef);
        if (batch.status == BatchStatus.Recalled) revert BatchIsRecalled(batchRef);
        if (fromRef != batch.custodian) revert NotCurrentCustodian(fromRef);
        if (batch.pendingRecipient != bytes32(0)) revert TransferAlreadyPending(batchRef);

        Organization storage to = _organizations[toRef];
        if (to.role == OrgRole.None || !to.active) revert OrganizationNotAuthorized(toRef);

        OrgRole fromRole = _organizations[fromRef].role;
        if (!_isValidRoute(fromRole, to.role)) {
            revert InvalidTransferRoute(uint8(fromRole), uint8(to.role));
        }

        batch.pendingRecipient = toRef;
        _recordEvent(batch, eventHash);

        emit TransferInitiated(batchRef, fromRef, toRef, eventHash);
    }

    /// @notice Record that the pending recipient has received the batch; custody moves to it.
    function acceptTransfer(bytes32 batchRef, bytes32 toRef, bytes32 eventHash) external onlyRole(RECORDER_ROLE) {
        if (eventHash == bytes32(0)) revert InvalidReference();
        Batch storage batch = _existingBatch(batchRef);
        if (batch.status == BatchStatus.Recalled) revert BatchIsRecalled(batchRef);
        if (batch.pendingRecipient == bytes32(0)) revert NoPendingTransfer(batchRef);
        if (batch.pendingRecipient != toRef) revert NotPendingRecipient(toRef);

        bytes32 fromRef = batch.custodian;
        batch.custodian = toRef;
        batch.pendingRecipient = bytes32(0);
        _recordEvent(batch, eventHash);

        emit TransferAccepted(batchRef, fromRef, toRef, eventHash);
    }

    /// @notice Record that the pending recipient refused the batch; custody is unchanged.
    function rejectTransfer(bytes32 batchRef, bytes32 toRef, bytes32 eventHash) external onlyRole(RECORDER_ROLE) {
        if (eventHash == bytes32(0)) revert InvalidReference();
        Batch storage batch = _existingBatch(batchRef);
        if (batch.pendingRecipient == bytes32(0)) revert NoPendingTransfer(batchRef);
        if (batch.pendingRecipient != toRef) revert NotPendingRecipient(toRef);

        batch.pendingRecipient = bytes32(0);
        _recordEvent(batch, eventHash);

        emit TransferRejected(batchRef, batch.custodian, toRef, eventHash);
    }

    /// @notice Recall a batch (regulator only). Blocks all further transfers and clears any pending one.
    function recallBatch(bytes32 batchRef, bytes32 reasonHash, bytes32 eventHash) external onlyRole(REGULATOR_ROLE) {
        if (eventHash == bytes32(0)) revert InvalidReference();
        Batch storage batch = _existingBatch(batchRef);
        if (batch.status == BatchStatus.Recalled) revert BatchIsRecalled(batchRef);

        batch.status = BatchStatus.Recalled;
        batch.pendingRecipient = bytes32(0);
        _recordEvent(batch, eventHash);

        emit BatchRecalled(batchRef, reasonHash, eventHash);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getBatch(bytes32 batchRef) external view returns (Batch memory) {
        return _batches[batchRef];
    }

    function getOrganization(bytes32 orgRef) external view returns (Organization memory) {
        return _organizations[orgRef];
    }

    function isRegistered(bytes32 batchRef) external view returns (bool) {
        return _batches[batchRef].status != BatchStatus.None;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _existingBatch(bytes32 batchRef) private view returns (Batch storage batch) {
        batch = _batches[batchRef];
        if (batch.status == BatchStatus.None) revert BatchNotRegistered(batchRef);
    }

    function _recordEvent(Batch storage batch, bytes32 eventHash) private {
        batch.lastEventHash = eventHash;
        unchecked {
            batch.eventCount += 1;
        }
    }

    function _isValidRoute(OrgRole fromRole, OrgRole toRole) private pure returns (bool) {
        return
            (fromRole == OrgRole.Manufacturer && toRole == OrgRole.Distributor) ||
            (fromRole == OrgRole.Distributor && toRole == OrgRole.Wholesaler) ||
            (fromRole == OrgRole.Wholesaler && toRole == OrgRole.Pharmacy);
    }
}
