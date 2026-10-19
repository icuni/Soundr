import { check } from './util.mjs';

export const SAMPLE_RATE = 48000;
export const MAX_SAMPLES = SAMPLE_RATE * 180;
export const FRAME_RATES = [
  { numerator: 12, denominator: 1 },
  { numerator: 60, denominator: 1 },
  { numerator: 24, denominator: 1 },
  { numerator: 25, denominator: 1 },
  { numerator: 30, denominator: 1 },
  { numerator: 24000, denominator: 1001 },
  { numerator: 30000, denominator: 1001 },
];
function divideRound(numerator, denominator) {
  const negative = numerator < 0n;
  const value = negative ? -numerator : numerator;
  const rounded = (value + denominator / 2n) / denominator;
  const result = Number(negative ? -rounded : rounded);
  check(Number.isSafeInteger(result), 'VALIDATION_ERROR', 'Time value exceeds sample precision.');
  return result;
}
export function frameToSample(frame, fps, rate = SAMPLE_RATE) {
  check(Number.isSafeInteger(frame), 'VALIDATION_ERROR', 'Frame position must be an integer.');
  return divideRound(BigInt(frame) * BigInt(rate) * BigInt(fps.denominator), BigInt(fps.numerator));
}
export function sampleToFrame(sample, fps, rate = SAMPLE_RATE) {
  check(Number.isSafeInteger(sample), 'VALIDATION_ERROR', 'Sample position must be an integer.');
  return divideRound(
    BigInt(sample) * BigInt(fps.numerator),
    BigInt(rate) * BigInt(fps.denominator),
  );
}
export const sameRate = (a, b) =>
  BigInt(a.numerator) * BigInt(b.denominator) === BigInt(b.numerator) * BigInt(a.denominator);
export function timecode(sample, fps, origin = '01:00:00:00') {
  const nominal = Math.round(fps.numerator / fps.denominator);
  const [h, m, s, f] = origin.split(':').map(Number);
  let total = (h * 3600 + m * 60 + s) * nominal + f + sampleToFrame(sample, fps);
  const ff = total % nominal;
  total = Math.floor(total / nominal);
  const ss = total % 60;
  total = Math.floor(total / 60);
  const mm = total % 60;
  const hh = Math.floor(total / 60);
  return [hh, mm, ss, ff].map((n) => String(n).padStart(2, '0')).join(':');
}
