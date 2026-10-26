import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { param } from '../lib/http.js';
import { clientHash, PUBLIC_ID_PATTERN } from '../lib/hash.js';
import { assessBatch, HEADLINES, loadBatchForAssessment } from '../services/assessment.js';
import { eventRows } from '../lib/serializers.js';
import { env } from '../config/env.js';
import { notifyRegulators } from '../services/notifications.js';

export const verifyRouter = Router();

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.isTest ? 10_000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many verification requests. Please wait a minute.' } }),
});

/** Accepts a bare identifier or a full verification URL and returns the normalised identifier. */
export function normaliseIdentifier(raw: string): string {
  let v = decodeURIComponent(raw).trim();
  const m = v.match(/\/verify\/([^/?#\s]+)/i);
  if (m) v = m[1];
  return v.toUpperCase().slice(0, 64);
}

const UNKNOWN_DISCLAIMER =
  'No registered batch matches this code, so MediChain cannot vouch for this pack. A missing record does not by itself prove a medicine is counterfeit, but you should not use it until a pharmacist or the medicines regulator has checked it.';

const DISCLAIMER =
  'This result confirms that the code matches a registered batch record and its recorded custody history. It does not by itself prove that the physical pack in your hand is genuine — check the packaging and buy from licensed pharmacies.';

/**
 * Public verification. No account required. Logs a privacy-conscious attempt record
 * (salted IP hash only — no raw IP, user agent or location).
 */
verifyRouter.get('/:code', verifyLimiter, async (req, res) => {
  const queried = normaliseIdentifier(param(req, 'code'));
  const channel = req.auth ? 'PARTNER' : 'PUBLIC';
  const verifiedAt = new Date();
  const batch = PUBLIC_ID_PATTERN.test(queried) ? await loadBatchForAssessment({ publicId: queried }) : null;

  if (!batch) {
    const reasons = PUBLIC_ID_PATTERN.test(queried)
      ? ['No batch with this identifier has been registered by an approved manufacturer']
      : ['This is not a valid MediChain identifier format'];
    await prisma.verificationAttempt.create({
      data: { queriedId: queried || '(empty)', result: 'UNKNOWN', reasons, channel, userId: req.auth?.user.id ?? null, clientHash: clientHash(req.ip) },
    });
    return res.json({ result: 'UNKNOWN', headline: HEADLINES.UNKNOWN, reasons, queriedId: queried, verifiedAt, disclaimer: UNKNOWN_DISCLAIMER, batch: null });
  }

  const a = await assessBatch(batch);
  await prisma.verificationAttempt.create({
    data: {
      batchId: batch.id,
      queriedId: queried,
      result: a.result,
      reasons: a.reasons,
      channel,
      userId: req.auth?.user.id ?? null,
      clientHash: clientHash(req.ip),
    },
  });
  if (a.result === 'SUSPICIOUS' && channel === 'PUBLIC') {
    // throttle regulator alerts to one per batch per hour
    const recent = await prisma.auditLog.findFirst({
      where: { action: 'verification.suspicious_alert', entityId: batch.id, createdAt: { gte: new Date(Date.now() - 3600_000) } },
    });
    if (!recent) {
      await notifyRegulators(prisma, {
        severity: 'WARNING',
        title: 'Suspicious verification result',
        message: `A public check of batch ${batch.batchNumber} (${batch.publicId}) returned "suspicious".`,
        link: `/app/batches/${batch.id}`,
      });
      await prisma.auditLog.create({ data: { action: 'verification.suspicious_alert', entityType: 'MedicineBatch', entityId: batch.id } });
    }
  }

  const recall = batch.recalls[0];
  res.json({
    result: a.result,
    headline: a.headline,
    reasons: a.reasons,
    queriedId: queried,
    verifiedAt,
    disclaimer: DISCLAIMER,
    checks: a.checks.map((c) => ({ key: c.key, label: c.label, status: c.status, detail: c.detail })),
    batch: {
      publicId: batch.publicId,
      batchNumber: batch.batchNumber,
      medicine: {
        name: batch.medicine.name,
        genericName: batch.medicine.genericName,
        strength: batch.medicine.strength,
        dosageForm: batch.medicine.dosageForm,
        category: batch.medicine.category,
      },
      manufacturer: { name: batch.manufacturer.name, country: batch.manufacturer.country },
      manufactureDate: batch.manufactureDate.toISOString().slice(0, 10),
      expiryDate: batch.expiryDate.toISOString().slice(0, 10),
      storageConditions: batch.storageConditions,
      status: batch.status,
      displayStatus: a.displayStatus,
      // Organization names are business information about licensed supply-chain parties.
      currentCustodian: { name: batch.currentCustodian.name, type: batch.currentCustodian.type, city: batch.currentCustodian.city },
    },
    recall: recall
      ? { reference: recall.reference, action: recall.action, classification: recall.classification, reason: recall.reason, createdAt: recall.createdAt }
      : null,
    journey: a.journey.map((s) => ({ ...s, org: s.org ? { name: s.org.name, city: s.org.city, country: s.org.country } : null })),
    events: eventRows(a, 'public'),
    chain: a.chain,
  });
});
