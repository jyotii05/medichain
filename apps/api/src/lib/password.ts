import { z } from 'zod';
import { env } from '../config/env.js';

/** Password policy shared by registration, admin-created accounts and password changes. */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const BCRYPT_COST = env.isTest ? 4 : 12;
