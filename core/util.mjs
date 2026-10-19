import { createHash, randomUUID } from 'node:crypto';

export class SoundrError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export function check(condition, code, message, details) {
  if (!condition) throw new SoundrError(code, message, details);
}
export const id = (prefix) => `${prefix}-${randomUUID()}`;
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value))
    .digest('hex');
export const copy = (value) => structuredClone(value);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const errorResult = (error, requestId = null) => ({
  ok: false,
  requestId,
  error: {
    code: error instanceof SoundrError ? error.code : 'IO_ERROR',
    message:
      error instanceof SoundrError
        ? error.message
        : 'Soundr could not complete the local operation.',
    details: error instanceof SoundrError ? error.details : {},
  },
});
