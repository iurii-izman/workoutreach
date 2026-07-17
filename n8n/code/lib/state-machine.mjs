import { SafeStop } from './errors.mjs';

export const JOB_TRANSITIONS = Object.freeze({
  RECEIVED: Object.freeze(['FETCHING', 'CANCELLED', 'FAILED']),
  FETCHING: Object.freeze(['ANALYZING', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED']),
  ANALYZING: Object.freeze(['NEEDS_CONTACT', 'NEEDS_REVIEW', 'DRAFT_READY', 'FAILED', 'CANCELLED']),
  NEEDS_CONTACT: Object.freeze(['ANALYZING', 'CANCELLED', 'EXPIRED']),
  NEEDS_REVIEW: Object.freeze(['ANALYZING', 'REJECTED', 'CANCELLED', 'EXPIRED']),
  DRAFT_READY: Object.freeze(['ANALYZING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED']),
  APPROVED: Object.freeze(['SENDING', 'FAILED']),
  SENDING: Object.freeze(['PROVIDER_ACCEPTED', 'FAILED']),
  PROVIDER_ACCEPTED: Object.freeze([]),
  REJECTED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  EXPIRED: Object.freeze([]),
  FAILED: Object.freeze([]),
});

export function canTransitionJob(from, to) {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertJobTransition(from, to) {
  if (!canTransitionJob(from, to)) throw new SafeStop('JOB_TRANSITION_INVALID', `Job transition ${from} -> ${to} is not allowed`);
  return to;
}
