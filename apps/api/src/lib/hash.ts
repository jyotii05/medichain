import { createHash, randomBytes } from 'node:crypto';
import { keccak256, toUtf8Bytes } from 'ethers';
import { env } from '../config/env.js';

/** Deterministic JSON serialisation (sorted keys) so hashes are reproducible. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** 0x-prefixed SHA-256 hex digest (32 bytes — fits a Solidity bytes32). */
export function sha256Hex(input: string): string {
  return `0x${createHash('sha256').update(input).digest('hex')}`;
}

export function keccakText(input: string): string {
  return keccak256(toUtf8Bytes(input));
}

export const GENESIS_HASH = `0x${'0'.repeat(64)}`;

/** On-chain references: opaque keccak256 hashes, never business data. */
export const batchChainRef = (publicId: string) => keccakText(`medichain:batch:${publicId}`);
export const orgChainRef = (organizationId: string) => keccakText(`medichain:org:${organizationId}`);

/** Salted, truncated client hash — lets us count abuse without storing raw IP addresses. */
export function clientHash(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${env.CLIENT_HASH_SALT}:${ip}`).digest('hex').slice(0, 16);
}

// Crockford base32 without ambiguous characters
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

/** Opaque public batch identifier, e.g. MC-7KQ2-XP4M-9TBA (60 bits of randomness). */
export function newPublicBatchId(): string {
  const c = randomCode(12);
  return `MC-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}

export const PUBLIC_ID_PATTERN = /^MC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function newReference(prefix: 'SHP' | 'RCL'): string {
  const year = new Date().getUTCFullYear();
  return `${prefix}-${year}-${randomCode(6)}`;
}
