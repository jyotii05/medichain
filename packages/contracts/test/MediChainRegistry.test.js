const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const OrgRole = { None: 0, Manufacturer: 1, Distributor: 2, Wholesaler: 3, Pharmacy: 4 };
const BatchStatus = { None: 0, Active: 1, Recalled: 2 };

const ref = (s) => ethers.id(s);
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

const ORG = {
  manufacturer: ref("org:manufacturer-1"),
  manufacturer2: ref("org:manufacturer-2"),
  distributor: ref("org:distributor-1"),
  distributor2: ref("org:distributor-2"),
  wholesaler: ref("org:wholesaler-1"),
  pharmacy: ref("org:pharmacy-1"),
  unknown: ref("org:unknown"),
};
const BATCH = ref("batch:PARA-500-0001");
const DATA_HASH = hash("batch-record:PARA-500-0001:v1");

describe("MediChainRegistry", function () {
  async function deployFixture() {
    const [admin, relayer, outsider] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MediChainRegistry");
    const registry = await Factory.deploy(admin.address);
    await registry.waitForDeployment();
    const REGULATOR_ROLE = await registry.REGULATOR_ROLE();
    const RECORDER_ROLE = await registry.RECORDER_ROLE();
    const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
    return { registry, admin, relayer, outsider, REGULATOR_ROLE, RECORDER_ROLE, DEFAULT_ADMIN_ROLE };
  }

  async function orgsFixture() {
    const base = await deployFixture();
    const { registry } = base;
    await registry.registerOrganization(ORG.manufacturer, OrgRole.Manufacturer);
    await registry.registerOrganization(ORG.manufacturer2, OrgRole.Manufacturer);
    await registry.registerOrganization(ORG.distributor, OrgRole.Distributor);
    await registry.registerOrganization(ORG.distributor2, OrgRole.Distributor);
    await registry.registerOrganization(ORG.wholesaler, OrgRole.Wholesaler);
    await registry.registerOrganization(ORG.pharmacy, OrgRole.Pharmacy);
    return base;
  }

  async function batchFixture() {
    const base = await orgsFixture();
    await base.registry.registerBatch(BATCH, ORG.manufacturer, DATA_HASH, hash("evt:register"));
    return base;
  }

  async function pendingFixture() {
    const base = await batchFixture();
    await base.registry.initiateTransfer(BATCH, ORG.manufacturer, ORG.distributor, hash("evt:ship-1"));
    return base;
  }

  describe("Deployment", function () {
    it("grants admin, regulator and recorder roles to the admin", async function () {
      const { registry, admin, outsider, REGULATOR_ROLE, RECORDER_ROLE, DEFAULT_ADMIN_ROLE } =
        await loadFixture(deployFixture);
      expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(true);
      expect(await registry.hasRole(REGULATOR_ROLE, admin.address)).to.equal(true);
      expect(await registry.hasRole(RECORDER_ROLE, admin.address)).to.equal(true);
      expect(await registry.hasRole(RECORDER_ROLE, outsider.address)).to.equal(false);
      expect(REGULATOR_ROLE).to.equal(ethers.id("REGULATOR_ROLE"));
      expect(RECORDER_ROLE).to.equal(ethers.id("RECORDER_ROLE"));
    });

    it("lets the admin grant roles to a relayer", async function () {
      const { registry, relayer, RECORDER_ROLE } = await loadFixture(deployFixture);
      await registry.grantRole(RECORDER_ROLE, relayer.address);
      expect(await registry.hasRole(RECORDER_ROLE, relayer.address)).to.equal(true);
    });
  });

  describe("Organizations", function () {
    it("registers an organization", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.registerOrganization(ORG.manufacturer, OrgRole.Manufacturer))
        .to.emit(registry, "OrganizationRegistered")
        .withArgs(ORG.manufacturer, OrgRole.Manufacturer);
      const org = await registry.getOrganization(ORG.manufacturer);
      expect(org.role).to.equal(OrgRole.Manufacturer);
      expect(org.active).to.equal(true);
    });

    it("rejects duplicate registration", async function () {
      const { registry } = await loadFixture(orgsFixture);
      await expect(registry.registerOrganization(ORG.manufacturer, OrgRole.Distributor))
        .to.be.revertedWithCustomError(registry, "OrganizationAlreadyRegistered")
        .withArgs(ORG.manufacturer);
    });

    it("rejects zero reference and None role", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(
        registry.registerOrganization(ethers.ZeroHash, OrgRole.Manufacturer)
      ).to.be.revertedWithCustomError(registry, "InvalidReference");
      await expect(registry.registerOrganization(ORG.manufacturer, OrgRole.None)).to.be.revertedWithCustomError(
        registry,
        "InvalidRole"
      );
    });

    it("rejects registration by a non-regulator", async function () {
      const { registry, outsider, REGULATOR_ROLE } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).registerOrganization(ORG.manufacturer, OrgRole.Manufacturer))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, REGULATOR_ROLE);
    });

    it("toggles active status and rejects unknown organizations", async function () {
      const { registry, outsider } = await loadFixture(orgsFixture);
      await expect(registry.setOrganizationActive(ORG.distributor, false))
        .to.emit(registry, "OrganizationStatusChanged")
        .withArgs(ORG.distributor, false);
      expect((await registry.getOrganization(ORG.distributor)).active).to.equal(false);
      await registry.setOrganizationActive(ORG.distributor, true);
      expect((await registry.getOrganization(ORG.distributor)).active).to.equal(true);
      await expect(registry.setOrganizationActive(ORG.unknown, false))
        .to.be.revertedWithCustomError(registry, "OrganizationNotRegistered")
        .withArgs(ORG.unknown);
      await expect(
        registry.connect(outsider).setOrganizationActive(ORG.distributor, false)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Batch registration", function () {
    it("registers a batch and emits BatchRegistered", async function () {
      const { registry } = await loadFixture(orgsFixture);
      const evt = hash("evt:register");
      expect(await registry.isRegistered(BATCH)).to.equal(false);
      await expect(registry.registerBatch(BATCH, ORG.manufacturer, DATA_HASH, evt))
        .to.emit(registry, "BatchRegistered")
        .withArgs(BATCH, ORG.manufacturer, DATA_HASH, evt);

      expect(await registry.isRegistered(BATCH)).to.equal(true);
      const b = await registry.getBatch(BATCH);
      const block = await ethers.provider.getBlock("latest");
      expect(b.manufacturer).to.equal(ORG.manufacturer);
      expect(b.custodian).to.equal(ORG.manufacturer);
      expect(b.pendingRecipient).to.equal(ethers.ZeroHash);
      expect(b.status).to.equal(BatchStatus.Active);
      expect(b.dataHash).to.equal(DATA_HASH);
      expect(b.lastEventHash).to.equal(evt);
      expect(b.registeredAt).to.equal(block.timestamp);
      expect(b.eventCount).to.equal(1);
    });

    it("rejects duplicate batch registration", async function () {
      const { registry } = await loadFixture(batchFixture);
      await expect(registry.registerBatch(BATCH, ORG.manufacturer, DATA_HASH, hash("evt:again")))
        .to.be.revertedWithCustomError(registry, "BatchAlreadyRegistered")
        .withArgs(BATCH);
    });

    it("rejects registration by an account without RECORDER_ROLE", async function () {
      const { registry, outsider, RECORDER_ROLE } = await loadFixture(orgsFixture);
      await expect(
        registry.connect(outsider).registerBatch(BATCH, ORG.manufacturer, DATA_HASH, hash("evt:register"))
      )
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, RECORDER_ROLE);
    });

    it("rejects zero batchRef, dataHash or eventHash", async function () {
      const { registry } = await loadFixture(orgsFixture);
      const evt = hash("evt:register");
      await expect(
        registry.registerBatch(ethers.ZeroHash, ORG.manufacturer, DATA_HASH, evt)
      ).to.be.revertedWithCustomError(registry, "InvalidReference");
      await expect(
        registry.registerBatch(BATCH, ORG.manufacturer, ethers.ZeroHash, evt)
      ).to.be.revertedWithCustomError(registry, "InvalidReference");
      await expect(
        registry.registerBatch(BATCH, ORG.manufacturer, DATA_HASH, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "InvalidReference");
    });

    it("rejects unregistered, inactive and non-manufacturer organizations", async function () {
      const { registry } = await loadFixture(orgsFixture);
      const evt = hash("evt:register");

      await expect(registry.registerBatch(BATCH, ORG.unknown, DATA_HASH, evt))
        .to.be.revertedWithCustomError(registry, "OrganizationNotAuthorized")
        .withArgs(ORG.unknown);

      await expect(registry.registerBatch(BATCH, ORG.distributor, DATA_HASH, evt))
        .to.be.revertedWithCustomError(registry, "OrganizationNotAuthorized")
        .withArgs(ORG.distributor);

      await registry.setOrganizationActive(ORG.manufacturer, false);
      await expect(registry.registerBatch(BATCH, ORG.manufacturer, DATA_HASH, evt))
        .to.be.revertedWithCustomError(registry, "OrganizationNotAuthorized")
        .withArgs(ORG.manufacturer);
    });
  });

  describe("Transfers", function () {
    it("completes the full Manufacturer -> Distributor -> Wholesaler -> Pharmacy path", async function () {
      const { registry } = await loadFixture(batchFixture);
      const hops = [
        [ORG.manufacturer, ORG.distributor],
        [ORG.distributor, ORG.wholesaler],
        [ORG.wholesaler, ORG.pharmacy],
      ];
      let expectedCount = 1;

      for (const [i, [from, to]] of hops.entries()) {
        const shipEvt = hash(`evt:ship-${i}`);
        await expect(registry.initiateTransfer(BATCH, from, to, shipEvt))
          .to.emit(registry, "TransferInitiated")
          .withArgs(BATCH, from, to, shipEvt);
        expectedCount++;
        let b = await registry.getBatch(BATCH);
        expect(b.custodian).to.equal(from);
        expect(b.pendingRecipient).to.equal(to);
        expect(b.lastEventHash).to.equal(shipEvt);
        expect(b.eventCount).to.equal(expectedCount);

        const recvEvt = hash(`evt:receive-${i}`);
        await expect(registry.acceptTransfer(BATCH, to, recvEvt))
          .to.emit(registry, "TransferAccepted")
          .withArgs(BATCH, from, to, recvEvt);
        expectedCount++;
        b = await registry.getBatch(BATCH);
        expect(b.custodian).to.equal(to);
        expect(b.pendingRecipient).to.equal(ethers.ZeroHash);
        expect(b.lastEventHash).to.equal(recvEvt);
        expect(b.eventCount).to.equal(expectedCount);
      }

      const final = await registry.getBatch(BATCH);
      expect(final.custodian).to.equal(ORG.pharmacy);
      expect(final.manufacturer).to.equal(ORG.manufacturer);
      expect(final.status).to.equal(BatchStatus.Active);
      expect(final.eventCount).to.equal(7);
    });

    it("rejects transfer initiated by a non-custodian", async function () {
      const { registry } = await loadFixture(batchFixture);
      await expect(registry.initiateTransfer(BATCH, ORG.distributor, ORG.wholesaler, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "NotCurrentCustodian")
        .withArgs(ORG.distributor);
    });

    it("rejects transfers on unregistered batches", async function () {
      const { registry } = await loadFixture(orgsFixture);
      const other = ref("batch:missing");
      await expect(registry.initiateTransfer(other, ORG.manufacturer, ORG.distributor, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "BatchNotRegistered")
        .withArgs(other);
      await expect(registry.acceptTransfer(other, ORG.distributor, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "BatchNotRegistered")
        .withArgs(other);
      await expect(registry.rejectTransfer(other, ORG.distributor, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "BatchNotRegistered")
        .withArgs(other);
    });

    it("rejects zero eventHash on transfer operations", async function () {
      const { registry } = await loadFixture(pendingFixture);
      await expect(
        registry.acceptTransfer(BATCH, ORG.distributor, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "InvalidReference");
      await expect(
        registry.rejectTransfer(BATCH, ORG.distributor, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "InvalidReference");
      await expect(registry.recallBatch(BATCH, hash("r"), ethers.ZeroHash)).to.be.revertedWithCustomError(
        registry,
        "InvalidReference"
      );
    });

    it("rejects Manufacturer -> Pharmacy (skipping steps)", async function () {
      const { registry } = await loadFixture(batchFixture);
      await expect(registry.initiateTransfer(BATCH, ORG.manufacturer, ORG.pharmacy, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "InvalidTransferRoute")
        .withArgs(OrgRole.Manufacturer, OrgRole.Pharmacy);
    });

    it("rejects Manufacturer -> Manufacturer and backwards routes", async function () {
      const { registry } = await loadFixture(batchFixture);
      await expect(registry.initiateTransfer(BATCH, ORG.manufacturer, ORG.manufacturer2, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "InvalidTransferRoute")
        .withArgs(OrgRole.Manufacturer, OrgRole.Manufacturer);

      await registry.initiateTransfer(BATCH, ORG.manufacturer, ORG.distributor, hash("evt:1"));
      await registry.acceptTransfer(BATCH, ORG.distributor, hash("evt:2"));
      await expect(registry.initiateTransfer(BATCH, ORG.distributor, ORG.manufacturer, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "InvalidTransferRoute")
        .withArgs(OrgRole.Distributor, OrgRole.Manufacturer);
    });

    it("rejects any transfer out of a Pharmacy", async function () {
      const { registry } = await loadFixture(batchFixture);
      const path = [ORG.manufacturer, ORG.distributor, ORG.wholesaler, ORG.pharmacy];
      for (let i = 0; i < path.length - 1; i++) {
        await registry.initiateTransfer(BATCH, path[i], path[i + 1], hash(`evt:s${i}`));
        await registry.acceptTransfer(BATCH, path[i + 1], hash(`evt:r${i}`));
      }
      const targets = [
        [ORG.manufacturer, OrgRole.Manufacturer],
        [ORG.distributor, OrgRole.Distributor],
        [ORG.wholesaler, OrgRole.Wholesaler],
      ];
      for (const [to, role] of targets) {
        await expect(registry.initiateTransfer(BATCH, ORG.pharmacy, to, hash("evt:x")))
          .to.be.revertedWithCustomError(registry, "InvalidTransferRoute")
          .withArgs(OrgRole.Pharmacy, role);
      }
    });

    it("rejects a second transfer while one is pending", async function () {
      const { registry } = await loadFixture(pendingFixture);
      await expect(registry.initiateTransfer(BATCH, ORG.manufacturer, ORG.distributor2, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "TransferAlreadyPending")
        .withArgs(BATCH);
    });

    it("rejects acceptance by the wrong recipient", async function () {
      const { registry } = await loadFixture(pendingFixture);
      await expect(registry.acceptTransfer(BATCH, ORG.distributor2, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "NotPendingRecipient")
        .withArgs(ORG.distributor2);
      await expect(registry.rejectTransfer(BATCH, ORG.distributor2, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "NotPendingRecipient")
        .withArgs(ORG.distributor2);
    });

    it("rejects duplicate acceptance", async function () {
      const { registry } = await loadFixture(pendingFixture);
      await registry.acceptTransfer(BATCH, ORG.distributor, hash("evt:recv"));
      await expect(registry.acceptTransfer(BATCH, ORG.distributor, hash("evt:recv-again")))
        .to.be.revertedWithCustomError(registry, "NoPendingTransfer")
        .withArgs(BATCH);
    });

    it("rejecting a transfer leaves custody unchanged and allows a new transfer", async function () {
      const { registry } = await loadFixture(pendingFixture);
      const evt = hash("evt:reject");
      await expect(registry.rejectTransfer(BATCH, ORG.distributor, evt))
        .to.emit(registry, "TransferRejected")
        .withArgs(BATCH, ORG.manufacturer, ORG.distributor, evt);

      const b = await registry.getBatch(BATCH);
      expect(b.custodian).to.equal(ORG.manufacturer);
      expect(b.pendingRecipient).to.equal(ethers.ZeroHash);
      expect(b.lastEventHash).to.equal(evt);
      expect(b.eventCount).to.equal(3);

      await expect(registry.rejectTransfer(BATCH, ORG.distributor, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "NoPendingTransfer")
        .withArgs(BATCH);

      await expect(registry.initiateTransfer(BATCH, ORG.manufacturer, ORG.distributor2, hash("evt:ship-2"))).to.emit(
        registry,
        "TransferInitiated"
      );
    });

    it("rejects transfer to an unregistered or deactivated organization", async function () {
      const { registry } = await loadFixture(batchFixture);
      await expect(registry.initiateTransfer(BATCH, ORG.manufacturer, ORG.unknown, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "OrganizationNotAuthorized")
        .withArgs(ORG.unknown);

      await registry.setOrganizationActive(ORG.distributor, false);
      await expect(registry.initiateTransfer(BATCH, ORG.manufacturer, ORG.distributor, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "OrganizationNotAuthorized")
        .withArgs(ORG.distributor);
    });

    it("rejects transfer operations from accounts without RECORDER_ROLE", async function () {
      const { registry, outsider } = await loadFixture(pendingFixture);
      await expect(
        registry.connect(outsider).acceptTransfer(BATCH, ORG.distributor, hash("evt:x"))
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await expect(
        registry.connect(outsider).rejectTransfer(BATCH, ORG.distributor, hash("evt:x"))
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await expect(
        registry.connect(outsider).initiateTransfer(BATCH, ORG.manufacturer, ORG.distributor, hash("evt:x"))
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Recall", function () {
    it("lets a regulator recall a batch, clearing the pending transfer and blocking further transfers", async function () {
      const { registry } = await loadFixture(pendingFixture);
      const reason = hash("reason:contamination");
      const evt = hash("evt:recall");
      await expect(registry.recallBatch(BATCH, reason, evt))
        .to.emit(registry, "BatchRecalled")
        .withArgs(BATCH, reason, evt);

      const b = await registry.getBatch(BATCH);
      expect(b.status).to.equal(BatchStatus.Recalled);
      expect(b.pendingRecipient).to.equal(ethers.ZeroHash);
      expect(b.lastEventHash).to.equal(evt);
      expect(b.eventCount).to.equal(3);

      await expect(registry.acceptTransfer(BATCH, ORG.distributor, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "BatchIsRecalled")
        .withArgs(BATCH);
      await expect(registry.initiateTransfer(BATCH, ORG.manufacturer, ORG.distributor, hash("evt:x")))
        .to.be.revertedWithCustomError(registry, "BatchIsRecalled")
        .withArgs(BATCH);
    });

    it("rejects recall by a non-regulator", async function () {
      const { registry, relayer, admin, REGULATOR_ROLE, RECORDER_ROLE } = await loadFixture(batchFixture);
      // A recorder-only account must not be able to recall.
      await registry.connect(admin).grantRole(RECORDER_ROLE, relayer.address);
      await expect(registry.connect(relayer).recallBatch(BATCH, hash("r"), hash("evt:recall")))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(relayer.address, REGULATOR_ROLE);
    });

    it("rejects a double recall and recall of an unknown batch", async function () {
      const { registry } = await loadFixture(batchFixture);
      await registry.recallBatch(BATCH, hash("r"), hash("evt:recall"));
      await expect(registry.recallBatch(BATCH, hash("r"), hash("evt:recall-2")))
        .to.be.revertedWithCustomError(registry, "BatchIsRecalled")
        .withArgs(BATCH);
      const other = ref("batch:missing");
      await expect(registry.recallBatch(other, hash("r"), hash("evt:recall")))
        .to.be.revertedWithCustomError(registry, "BatchNotRegistered")
        .withArgs(other);
    });
  });

  describe("Event log verification", function () {
    it("emitted eventHash arguments match the submitted hashes and getBatch().lastEventHash", async function () {
      const { registry } = await loadFixture(orgsFixture);
      const address = await registry.getAddress();

      const steps = [
        { name: "BatchRegistered", send: (e) => registry.registerBatch(BATCH, ORG.manufacturer, DATA_HASH, e) },
        {
          name: "TransferInitiated",
          send: (e) => registry.initiateTransfer(BATCH, ORG.manufacturer, ORG.distributor, e),
        },
        { name: "TransferAccepted", send: (e) => registry.acceptTransfer(BATCH, ORG.distributor, e) },
        {
          name: "TransferInitiated",
          send: (e) => registry.initiateTransfer(BATCH, ORG.distributor, ORG.wholesaler, e),
        },
        { name: "TransferRejected", send: (e) => registry.rejectTransfer(BATCH, ORG.wholesaler, e) },
        { name: "BatchRecalled", send: (e) => registry.recallBatch(BATCH, hash("reason:qa"), e) },
      ];

      const sent = [];
      for (const [i, step] of steps.entries()) {
        const eventHash = hash(`off-chain-event:${i}:${step.name}`);
        const tx = await step.send(eventHash);
        const receipt = await tx.wait();

        const parsed = receipt.logs
          .filter((l) => l.address === address)
          .map((l) => registry.interface.parseLog(l))
          .filter(Boolean);
        expect(parsed).to.have.lengthOf(1);
        expect(parsed[0].name).to.equal(step.name);
        expect(parsed[0].args.batchRef).to.equal(BATCH);
        expect(parsed[0].args.eventHash).to.equal(eventHash);

        const b = await registry.getBatch(BATCH);
        expect(b.lastEventHash).to.equal(eventHash);
        expect(b.eventCount).to.equal(i + 1);
        sent.push({ name: step.name, eventHash });
      }

      // Re-read the full history from chain logs (as an auditor would) and compare.
      const all = [];
      for (const name of ["BatchRegistered", "TransferInitiated", "TransferAccepted", "TransferRejected", "BatchRecalled"]) {
        const logs = await registry.queryFilter(registry.filters[name](BATCH));
        for (const log of logs) {
          all.push({ name, eventHash: log.args.eventHash, block: log.blockNumber, index: log.index });
        }
      }
      all.sort((a, b) => a.block - b.block || a.index - b.index);
      expect(all.map(({ name, eventHash }) => ({ name, eventHash }))).to.deep.equal(sent);
    });
  });
});
