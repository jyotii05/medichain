# MediChain — Blockchain-Based Medicine Supply Chain Management

> **Every medicine. Every journey. Verified.**
> An academic / portfolio project that shows how a tamper-evident ledger and a blockchain smart contract
> can make medicine custody traceable from manufacturer to pharmacy, and how anyone can check a pack's
> recorded journey with a QR scan.

MediChain is a full-stack application: a React web app, an Express + PostgreSQL REST API, and a
Solidity smart contract with a Hardhat toolchain. It is a real working system, not a UI mock-up. Every
number on screen comes from the database, and every custody change goes through server-side business
rules, a hash-chained event log and (optionally) a real on-chain transaction.

> **Important limitation.** MediChain verifies *registered records and recorded custody history*. A
> "Verified record" result means the code resolves to a registered batch whose recorded history is
> consistent. It does **not** by itself prove that the physical pack is genuine: a counterfeiter can copy
> a real QR code. Physical authenticity still depends on trusted manufacturers, inspections and accurate
> data entry. The UI says this wherever a verification result is shown.

---

## Contents

1. [Problem statement & objectives](#1-problem-statement--objectives)
2. [Features](#2-features)
3. [Technology stack](#3-technology-stack)
4. [Architecture](#4-architecture)
5. [User roles & permissions](#5-user-roles--permissions)
6. [Database design](#6-database-design)
7. [Blockchain workflow — simulation vs on-chain](#7-blockchain-workflow--simulation-vs-on-chain)
8. [QR verification workflow](#8-qr-verification-workflow)
9. [Getting started](#9-getting-started)
10. [Environment configuration](#10-environment-configuration)
11. [Smart contract deployment](#11-smart-contract-deployment)
12. [Demo accounts & sample data](#12-demo-accounts--sample-data)
13. [Testing](#13-testing)
14. [Deployment (GitHub, Vercel, API, PostgreSQL)](#14-deployment)
15. [Security](#15-security)
16. [Limitations](#16-limitations)
17. [Future improvements](#17-future-improvements)
18. [Project structure](#18-project-structure)

---

## 1. Problem statement & objectives

Counterfeit and substandard medicines enter supply chains where custody is recorded on paper or in
siloed systems that nobody outside the company can check. When a batch is recalled, it is hard to
know where it went. When a patient or pharmacist holds a pack, they cannot see where it has been.

**Objectives**

- Give every medicine batch a unique, opaque digital identity printed as a QR code.
- Record every authorised custody transfer (Manufacturer → Distributor → Wholesaler → Pharmacy) as an
  append-only, hash-chained event, anchored to a blockchain or a clearly labelled simulated ledger.
- Let anyone verify a pack without an account, and flag **unknown**, **duplicated**, **recalled**,
  **expired** or **inconsistent** records. An unknown code is never shown as verified.
- Give regulators recall, oversight, audit and reporting tools.
- Enforce every rule on the server: roles, ownership, state transitions and concurrency.

## 2. Features

| Area | What's implemented |
|---|---|
| **Authentication** | Email/password login (bcrypt cost 12). JWT in an httpOnly cookie. "Keep me signed in" option (7 days instead of a 12-hour session). Double-submit CSRF token. Rate-limited login. Forgot-password flow that never reveals which accounts exist. Password change revokes other sessions. |
| **RBAC** | Five roles, each with its own navigation, enforced by backend middleware and data scoping. Users only see batches their organization made, holds or has handled. |
| **Dashboard** | Role-specific statistics, 30-day activity chart, batch-status breakdown, pending approvals, recent registrations, transfers and alerts, ledger/chain activity, quick actions. Shows an onboarding screen with a "Load sample data (development)" button when the database is empty. |
| **Batch registration** | Detailed form validated by zod on the client and again on the server. Checks the licence against the organization record, dates, duplicate batch numbers and quantity. Optional initial shipment. Success screen with QR code, downloads and a printable label. |
| **Batch details** | Integrity panel (8 automated checks), journey timeline, product details, hash-chained event log showing database IDs, event hashes, previous hashes and tx hash or simulated reference, plus shipments and flags. |
| **Custody transfers** | Two-step handover: only the custodian can initiate, and only the intended recipient can accept or reject (a reason is required to reject). Shipments can only go to the next stage. Row locks plus a partial unique index stop conflicting transfers. |
| **Supply-chain tracking** | Interactive journey: horizontal on desktop, vertical on mobile, selectable stages. Missing, unrecorded, rejected and cancelled stages are marked; stages with no record are never invented. |
| **Inventory** | Custody view per organization. Pharmacies record dispensing; stock can never go negative (service check plus database CHECK constraint). |
| **QR codes** | Generated client- and server-side (PNG/SVG). Each encodes only `<app>/verify/<opaque id>`. Print-friendly label. |
| **Public verification** | Camera scanning (qr-scanner), QR image upload and manual ID entry. Results: Verified record, Suspicious, Unknown, Recalled, Expired. Shows the journey, the check list, blockchain details and a disclaimer. Each check is logged without storing raw IPs. |
| **Recalls** | Regulator-only recall or block (Class I/II/III). Confirmation requires typing the batch number. Pending shipments are cancelled, the organizations involved are alerted, and transfers and dispensing are blocked. Recall warnings appear on the public page. |
| **Suspicion flags** | Partners flag batches; regulators review and resolve them. Open flags make public verification return *Suspicious*. |
| **Partners & users** | Organization directory. Regulator approves or suspends organizations and creates or disables users (a user's role always follows their organization's type). |
| **Blockchain records** | Mode status card, ledger integrity scan, retry for failed on-chain writes, transaction explorer with per-record re-verification (reads on-chain receipt logs). |
| **Reports** | Charts for weekly activity, transfers, verification results and chain status. Report explorer for batches, expiring, expired, recalls, transfers, verifications, organizations and blockchain, with date, status and search filters and CSV export (protected against formula injection). |
| **Notifications & audit** | Per-user notifications (shipments, recalls, flags, approvals). Append-only audit trail of sensitive actions. |

## 3. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, TypeScript 5.9, Tailwind CSS v4, Radix UI primitives (shadcn-style components), React Router 7, TanStack Query 5, React Hook Form + Zod, Recharts 3, Lucide icons, Sonner toasts, `qrcode`, `qr-scanner` |
| Backend | Node.js (≥ 20.11), Express 5, TypeScript, Zod validation, JWT (`jsonwebtoken`), bcryptjs, helmet, express-rate-limit, cookie-parser, CORS |
| Database | PostgreSQL 17, Prisma ORM 6 (migrations + seed). For local development, `embedded-postgres` runs a real PostgreSQL server from npm, so no install or Docker is needed |
| Blockchain | Solidity 0.8.28, OpenZeppelin AccessControl, Hardhat 2, ethers.js v6 |
| Testing | Vitest + Supertest (API, real PostgreSQL), Hardhat Mocha/Chai (contract), Vitest + Testing Library (web) |

All dependency versions are pinned exactly in each `package.json`.

## 4. Architecture

```
                       ┌──────────────────────────────┐
  Browser / phone ───▶ │  apps/web  (React SPA, Vite)  │  /verify/:id is public; /app/* needs a session
                       └──────────────┬───────────────┘
                                      │  same-origin /api (Vite proxy locally, Vercel rewrite in prod)
                       ┌──────────────▼───────────────┐
                       │  apps/api  (Express 5 REST)   │  auth · RBAC · validation · rate limits · CSRF
                       │  ─ services: batches, transfers, recalls, assessment (verification engine)
                       │  ─ hash-chained SupplyChainEvent log (SHA-256, per batch)
                       │  ─ blockchain adapter ─┬─ SIMULATION: hash-chained ledger table in PostgreSQL
                       │                        └─ ONCHAIN: relayer → MediChainRegistry (ethers v6)
                       └──────┬─────────────────────────┬──────┘
                              │ Prisma                  │ JSON-RPC
                  ┌───────────▼──────────┐   ┌──────────▼──────────────────┐
                  │  PostgreSQL 17       │   │  Hardhat node / EVM network  │
                  │  full business data  │   │  opaque refs + hashes only   │
                  └──────────────────────┘   └─────────────────────────────┘
```

**Write path (e.g. accept a transfer).** The API locks the batch row (`SELECT … FOR UPDATE`) and
re-reads the transfer. It checks the recipient, the status, recall state and custody, then updates
custody and appends a `SupplyChainEvent` whose `hash = SHA-256(canonical JSON incl. prevHash)`. It
writes the blockchain record inside the same database transaction: a confirmed ledger entry in
simulation mode, or a pending row in on-chain mode, which the relayer submits after commit (strictly
in order).

**Verification engine** (`apps/api/src/services/assessment.ts`) runs these checks:

1. Record integrity: re-hash every event and check every `prevHash` link.
2. Custody replay: every custody change must be backed by an accepted transfer from the custodian
   along a valid route.
3. Manufacturer approval.
4. Open partner flags.
5. Duplicate-use indicator (public scan volume).
6. Expiry.
7. Recall/block.
8. Anchors: simulated ledger re-hash, or on-chain `getBatch()` state plus receipt-log comparison.

The verdict takes the first match in this order: **Recalled**, **Expired**, **Suspicious** (any failed
check), **Verified record**. Unregistered codes return **Unknown**.

## 5. User roles & permissions

| Capability | Regulator | Manufacturer | Distributor | Wholesaler | Pharmacy | Public |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| View all batches & activity | ✓ | own | handled | handled | handled | — |
| Register batches / generate QR | — | ✓ | — | — | — | — |
| Initiate transfer (custodian only) | — | → distributor | → wholesaler | → pharmacy | — | — |
| Accept / reject incoming transfer | — | — | ✓ | ✓ | ✓ | — |
| Record dispensing | — | — | — | — | ✓ | — |
| Flag suspicious batch | — | ✓ | ✓ | ✓ | ✓ | — |
| Recall / block, resolve flags | ✓ | — | — | — | — | — |
| Approve / suspend organizations, manage users, audit trail | ✓ | — | — | — | — | — |
| Reports & CSV export | all data | scoped | scoped | scoped | scoped | — |
| Verify a medicine | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

The server enforces every rule (`requireRole`, `requireApprovedOrg`, ownership scoping in queries, and
service-level checks). Hiding a button in the UI is only cosmetic, so editing URLs or crafting API
requests does not bypass these checks; the API test suite covers this.

## 6. Database design

Prisma schema: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) · migration:
[`apps/api/prisma/migrations`](apps/api/prisma/migrations)

| Model | Purpose |
|---|---|
| `Organization` | Supply-chain party (type, status PENDING/APPROVED/SUSPENDED, licence, `chainRef` = keccak256 reference) |
| `User`, `OrganizationMembership` | Accounts; one organization per user, role = organization type, `tokenVersion` for session revocation |
| `Medicine` | Product information (name, generic, category, form, strength), separate from batches |
| `MedicineBatch` | A physical lot: opaque `publicId`, batch number (unique per manufacturer), dates, quantity / on-hand, status, current custodian, `dataHash`, `chainRef` |
| `CustodyTransfer` | Whole-batch handover workflow (PENDING → ACCEPTED / REJECTED / CANCELLED) |
| `SupplyChainEvent` | Append-only per-batch hash chain (`sequence`, `prevHash`, `hash`) |
| `RecallRecord` | Recall/block with classification, reason, initiator |
| `BatchFlag` | Partner suspicion reports and regulator resolutions |
| `VerificationAttempt` | Privacy-conscious lookup log (result, reasons, channel, salted IP hash only) |
| `BlockchainTransaction` | On-chain tx (`txHash`, `blockNumber`, `chainId`, `contractAddress`) **or** simulated ledger entry (`simulatedRef`, `ledgerSequence`, `ledgerHash`, `prevLedgerHash`), never both |
| `Notification`, `AuditLog` | User alerts; append-only audit trail |

**Guarantees enforced in PostgreSQL itself** (hand-written SQL in the migration):

- A partial unique index allows only one `PENDING` transfer per batch.
- CHECK constraints: quantity > 0, `0 ≤ quantityOnHand ≤ quantity`, expiry > manufacture date, and
  sender ≠ recipient.
- Triggers reject `UPDATE`/`DELETE` on `SupplyChainEvent` and `AuditLog`, making them append-only.

## 7. Blockchain workflow — simulation vs on-chain

Set `BLOCKCHAIN_MODE` in `apps/api/.env`. The UI always shows which mode is active.

### Simulation mode (`BLOCKCHAIN_MODE=simulation`, default)

- Each supply-chain event is appended to a **hash-chained ledger table** in PostgreSQL. Each entry
  commits to the previous one (`ledgerHash = SHA-256(seq, prevLedgerHash, operation, eventHash)`).
- Entries are labelled `SIM-000042-1A2B3C4D` and are never called transaction hashes.
- This demonstrates tamper evidence: editing or deleting a past entry breaks every later link, and the
  "Verify ledger integrity" scan reports it. It is **not a blockchain**: there is no consensus and no
  independent copy, and a database operator could rebuild the chain.

### On-chain mode (`BLOCKCHAIN_MODE=onchain`)

- The API acts as an authorised **relayer** holding `RECORDER_ROLE` and `REGULATOR_ROLE` on
  [`MediChainRegistry`](packages/contracts/contracts/MediChainRegistry.sol).
- On-chain data is minimal: keccak256 batch and organization references, the batch `dataHash`, each
  event's SHA-256 hash, and recall reason hashes. **No names, quantities, personal or patient data go
  on-chain.**
- The contract enforces the same state machine as the API:
  - No duplicate registration.
  - Only the current custodian can transfer.
  - Valid routes only.
  - Only the pending recipient can accept or reject.
  - No transfers after a recall.
  - Only regulators can recall.
- Every change emits an event: `BatchRegistered`, `TransferInitiated`, `TransferAccepted`,
  `TransferRejected`, `BatchRecalled`, `OrganizationRegistered`, `OrganizationStatusChanged`.
- Writes happen after the DB commit, serialised through a single queue. Records store `txHash`,
  `blockNumber`, `chainId` and `contractAddress`. A failed write (node down, revert) is marked
  `FAILED`. That batch's later writes are held back so the contract never sees operations out of order,
  and a regulator can **Retry failed writes** once the node is back.
- Verification reads `getBatch()` from the contract and compares it with the database: last event hash,
  data hash, custodian and recall status. It then re-reads the latest transaction receipt to confirm its
  event log carries the expected hash. If the node is unreachable, the result says **"Blockchain
  verification unavailable"**; it never invents a hash.

**Identifier glossary** (shown separately everywhere in the UI):
*Database event ID* (cuid of a `SupplyChainEvent`) · *Event hash* (SHA-256 of the event) ·
*Blockchain transaction hash* + *block number* (on-chain only) · *Simulated reference* (`SIM-…`, simulation only).

## 8. QR verification workflow

1. On registration the batch gets an opaque ID such as `MC-7KQ2-XP4M-9TBA` (60 random bits, Crockford
   alphabet). The QR code encodes only `PUBLIC_APP_URL/verify/MC-7KQ2-XP4M-9TBA`.
2. Anyone opens that URL, scans with the camera, uploads a photo of the code, or types the ID. QR codes
   that are not MediChain codes are rejected in the browser and never sent to the API.
3. `GET /api/verify/:code` (30 requests/min/IP) runs the verification engine and returns the verdict,
   reasons, check list, medicine facts, recorded journey, recall info and blockchain details.
4. The lookup is logged as a `VerificationAttempt` with a salted, truncated IP hash only: no raw IP, no
   user agent, no location. Suspicious public results notify regulators (throttled to one alert per
   batch per hour). More than `DUPLICATE_SCAN_THRESHOLD` public checks of one code in 24 hours is treated
   as a sign that the code has been copied onto other packs.

## 9. Getting started

**Prerequisites:** Node.js 20.11+ (tested on Node 24) and npm 10+. PostgreSQL and Docker are
**not** required for local development.

```bash
# 1. Install dependencies (three independent packages)
npm run install:all

# 2. Configure the API (then edit JWT_SECRET / CLIENT_HASH_SALT to random values)
cp apps/api/.env.example apps/api/.env

# 3. Start PostgreSQL — terminal 1 (embedded PostgreSQL 17 on port 54329, data in ~/.medichain/pgdata)
npm run db:start

# 4. Create the schema and load demo data — terminal 2
npm run db:setup          # prisma generate + migrate deploy + seed (organizations, users, 12 sample batches)

# 5. Run the API (http://localhost:4000) and the web app (http://localhost:5173)
npm run dev:api           # terminal 2
npm run dev:web           # terminal 3
```

Open http://localhost:5173 and sign in with a demo account (see §12), or open
http://localhost:5173/verify to try public verification.

> **Using your own PostgreSQL instead?** Skip `db:start` and point `DATABASE_URL` / `TEST_DATABASE_URL`
> at your server. Create the two databases first.
>
> **npm 11 note:** npm 11 blocks dependency install scripts by default. Everything here works without
> them because `prisma generate` runs explicitly in `db:setup` and `build`.

Useful API scripts (`apps/api`): `db:migrate` (create a new migration), `db:seed:base` (organizations
and users only, so the dashboard shows the onboarding state), `db:reset`, `typecheck`, `build`, `start`.

## 10. Environment configuration

`apps/api/.env` (see [`apps/api/.env.example`](apps/api/.env.example)):

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `TEST_DATABASE_URL` | tests | Separate database for the API test suite (must contain `medichain_test`) |
| `JWT_SECRET` | ✓ | ≥ 32 random characters |
| `CLIENT_HASH_SALT` | ✓ | Salt for hashing client IPs in verification/audit logs |
| `CORS_ORIGINS` | ✓ | Comma-separated allowed browser origins |
| `PUBLIC_APP_URL` | ✓ | Public web URL, embedded in QR codes |
| `COOKIE_SECURE` | prod | `true` when served over HTTPS |
| `ALLOW_DEMO_SEED` | — | Enables the dev-only sample-data endpoint (always off when `NODE_ENV=production`) |
| `BLOCKCHAIN_MODE` | — | `simulation` (default) or `onchain` |
| `CHAIN_RPC_URL` | onchain | JSON-RPC endpoint (default `http://127.0.0.1:8545`) |
| `CONTRACT_ADDRESS` | onchain | Deployed `MediChainRegistry` address |
| `RELAYER_PRIVATE_KEY` | onchain | Key holding RECORDER_ROLE + REGULATOR_ROLE. **Never use a key that controls real funds.** |
| `DUPLICATE_SCAN_THRESHOLD` | — | Public checks per 24 h that mark a code as possibly cloned (default 50) |

`apps/web/.env` — `VITE_API_URL` (optional; leave empty when the API is served under `/api` on the same origin).
`packages/contracts/.env` — `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `RELAYER_ADDRESS` (only for testnet deployment).

## 11. Smart contract deployment

```bash
# Terminal A — local development chain (chainId 31337, prints 20 funded dev accounts)
npm run chain:node

# Terminal B — compile + deploy (writes packages/contracts/deployments/localhost.json)
npm run chain:deploy
```

Then set in `apps/api/.env`:

```env
BLOCKCHAIN_MODE=onchain
CONTRACT_ADDRESS=<address printed by the deploy script>
# Hardhat dev account #0 — public, worthless outside the local dev chain
RELAYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Restart the API. The Blockchain records page should show **"On-chain connected"**. If you switch modes
with existing data, events recorded earlier stay anchored only in the mode they were written in, and the
UI notes this. For a clean on-chain demo, reset and re-seed (`npm --prefix apps/api run db:reset` then
`npm --prefix apps/api run db:seed`) while the node is running. Restarting `hardhat node` wipes the chain,
so redeploy and re-seed after a restart.

**Testnet (optional):** set `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` (and optionally
`RELAYER_ADDRESS`) in `packages/contracts/.env` and run `npm --prefix packages/contracts run deploy:sepolia`.

## 12. Demo accounts & sample data

**Development only.** These fictional accounts are created by the seed script and shown on the login
page only when the API runs with demo seeding enabled. Never enable them in production.

| Role | Email | Organization |
|---|---|---|
| Regulator | `regulator@medichain.demo` | Meridian Medicines Authority |
| Manufacturer | `manufacturer@medichain.demo` | Aurelia Pharmaceuticals Ltd. |
| Distributor | `distributor@medichain.demo` | Harbourline Distribution Co. |
| Wholesaler | `wholesaler@medichain.demo` | Greenfield Medical Wholesale |
| Pharmacy | `pharmacy@medichain.demo` | CityCare Pharmacy — Central |

Password for all: **`MediChain@2026`**. More accounts: `northwind@`, `summit@`, `riverside@`,
`oakwood@`, and `crestline@` (a *pending* manufacturer, to demonstrate approval).

**Sample scenarios.** All organizations, people and products are fictional and flagged `isDemo`.

| Batch | Scenario | Public verification result |
|---|---|---|
| `AMX-2026-0915` Amoxil-A | Complete journey to a pharmacy, partially dispensed | Verified record |
| `PCM-2026-1102` Paracel | Pending distributor → wholesaler transfer | Verified record (in transit) |
| `AZM-2026-0921` Azitra | Shipped by manufacturer, awaiting acceptance | Verified record (in transit) |
| `ATV-2026-0420` Lipitra | Class II recall | Recalled |
| `LOS-2026-0218` Losarta | Regulatory block (Class I) | Recalled (blocked) |
| `MTF-2023-0611` Glucomet | Expired | Expired |
| `INS-2026-0077` Glargena | **Incomplete journey:** custodian changed in the DB without a transfer record (deliberate tampering demo) | Suspicious: missing wholesaler stage, unrecorded custody |
| `CIP-2026-0505` Ciproxa | Flagged by a pharmacy | Suspicious |
| `SAL-2026-0310` Respira | Rejected shipment, then re-routed | Verified record |
| `OMP`, `IBU`, `CTZ` | Fresh, near-expiry and in-progress batches | Verified record |

The seed refuses to run when `NODE_ENV=production`, and the `/api/dev/*` routes are not mounted in production.

## 13. Testing

```bash
npm test                 # everything below
npm run test:contracts   # Hardhat — 29 contract tests
npm run test:api         # Vitest + Supertest against a real PostgreSQL test database
npm run test:web         # Vitest + Testing Library
```

- **Contract:**
  - Roles and access control.
  - Organization registration.
  - Duplicate batch prevention.
  - Full custody path.
  - Rejected operations: non-custodian, invalid route, double pending, wrong recipient, duplicate
    acceptance, deactivated recipient.
  - Recall restrictions.
  - Event-log verification.
- **API** (requires `npm run db:start`; uses `medichain_test` only):
  - Authentication and CSRF.
  - Role-based authorization and data scoping.
  - Batch registration validation and duplicates.
  - The transfer state machine, including **parallel** accept/initiate/recall/dispense races.
  - Database constraints and append-only triggers.
  - Verification: verified, unknown, malformed, expired, recalled, flagged, custody-tampering and
    event-hash tampering.
  - Privacy of public responses.
  - Recalls, inventory, simulated-ledger tampering detection, dashboard/report figures and CSV injection.
- **On-chain integration** (`apps/api/test/onchain.test.ts`): runs automatically when a Hardhat node is
  reachable on `127.0.0.1:8545` (chainId 31337) and the contract is compiled; otherwise it is skipped. It
  deploys a fresh contract, runs registration → transfer → acceptance → recall in on-chain mode, checks
  tx hashes, block numbers and receipt logs, and proves that DB custody tampering is caught by comparing
  with on-chain state.
- **Web:** verification result rendering, e.g. an unknown code is never rendered as verified.

## 14. Deployment

Ready for GitHub: `.gitignore` excludes `node_modules`, build output, `.env*` (except examples),
Hardhat artifacts and local deployments, and no secrets are committed. The pieces deploy separately:

1. **PostgreSQL:** any managed PostgreSQL 14+ (Neon, Supabase, RDS, Render…). Set `DATABASE_URL`, then
   run `npm --prefix apps/api run db:deploy` (migrations only; do not seed production).
2. **API:** any Node host (Render, Railway, Fly.io, a VM). Build: `npm ci && npm run build` in
   `apps/api`. Start: `npm start`. Set `NODE_ENV=production`, `COOKIE_SECURE=true`, a strong
   `JWT_SECRET` and `CLIENT_HASH_SALT`, `CORS_ORIGINS`, `PUBLIC_APP_URL`, and the blockchain variables
   if using on-chain mode (a testnet RPC plus a dedicated relayer key kept in the host's secret store).
3. **Web (Vercel):** import the repo, set **Root Directory** to `apps/web` (framework: Vite). Edit
   [`apps/web/vercel.json`](apps/web/vercel.json) and replace `YOUR-API-HOST.example.com` with your API
   host. The rewrite keeps `/api` on the same origin, so session cookies stay first-party and CSRF
   protection works. The SPA fallback rewrite makes deep links like `/verify/MC-…` work after deployment.

A successful frontend build does not mean the whole system is deployed. The API and database must be
deployed and configured as well.

## 15. Security

**Implemented:**

- bcrypt password hashing.
- httpOnly + SameSite=Lax session cookie (Secure in production).
- Double-submit CSRF token.
- JWT token versioning for revocation.
- Server-side RBAC and ownership checks.
- Zod validation on every input.
- Prisma parameterised queries.
- helmet security headers and a CORS allow-list.
- Rate limits on login, forgot-password and public verification.
- Generic error messages: no stack traces or user enumeration.
- Audit log for sensitive actions.
- Secrets only in environment variables.
- Opaque QR identifiers.
- Salted IP hashes instead of raw IPs.
- Formula-injection-safe CSV export.

**Not production-hardened:** this project has not had a professional security review or penetration
test. Before real-world use it would need:
- Email delivery for password resets.
- MFA for regulators.
- Secret rotation.
- Key management (HSM/KMS) for the relayer.
- Centralised logging and monitoring.
- A formal threat model.

## 16. Limitations

- **Whole-batch custody.** Transfers move an entire batch; partial shipments and splitting a batch are
  not modelled. Pharmacies record dispensing, which reduces units on hand, and a partially dispensed
  batch cannot be transferred onward.
- **Relayer model.** Partners don't hold wallets; the API signs on-chain writes on their behalf. On-chain
  data proves what the API recorded, not that each partner personally signed it.
- **Garbage in, garbage out.** The system checks consistency, not truth. A dishonest manufacturer can
  register false data, and a copied QR code resolves to a genuine record. Duplicate-scan detection is
  only a heuristic.
- **Simulation mode is not a blockchain.** It offers tamper evidence inside one database, not
  decentralised trust.
- **Event timestamps** come from the API server clock.
- **Password reset** is interface-only (no email provider).
- **On-chain writes are asynchronous.** A freshly recorded event shows *pending* until mined.

## 17. Future improvements

- Partner-held wallets or EIP-712 signatures so each organization signs its own custody changes.
- Serialised, pack-level identifiers (GS1 DataMatrix / EPCIS) and partial shipments.
- A Layer-2 or permissioned network (e.g. Hyperledger Besu) with multiple validator organizations.
- Background job queue (BullMQ) for chain writes, with metrics and alerting.
- Email/SMS notifications, MFA and SSO for organizations.
- Geofenced or anomaly-based clone detection on verification patterns.
- Offline-first pharmacy scanning (PWA).

## 18. Project structure

```
.
├── apps/
│   ├── api/                      Express + Prisma REST API
│   │   ├── prisma/               schema.prisma, migrations/, seed.ts
│   │   ├── scripts/dev-db.mjs    embedded PostgreSQL launcher
│   │   ├── src/
│   │   │   ├── blockchain/       simulation ledger, on-chain relayer, ABI
│   │   │   ├── config/ lib/ middleware/
│   │   │   ├── modules/          route handlers (auth, batches, transfers, verify, recalls, …)
│   │   │   ├── services/         business rules (batches, transfers, recalls, events, assessment)
│   │   │   └── seed/demo.ts      development demo data
│   │   └── test/                 Vitest + Supertest suites (incl. on-chain integration)
│   └── web/                      React SPA
│       └── src/
│           ├── components/       ui/ (primitives), shared/ (DataTable, StatCard, …),
│           │                     batch/ (SupplyChainTimeline, QRCodePanel), verify/, transfers/, recalls/, …
│           ├── pages/            one file per screen
│           └── lib/              API client, auth, types, utils
├── packages/contracts/           Hardhat project: MediChainRegistry.sol, deploy scripts, tests
└── docs/openapi.yaml             OpenAPI 3 specification of the REST API
```

API reference: [`docs/openapi.yaml`](docs/openapi.yaml). Open it in Swagger Editor or any OpenAPI viewer.

---

*MediChain is an academic and portfolio project. All organizations, people and medicines in the demo
data are fictional.*
