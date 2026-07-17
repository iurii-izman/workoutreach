import test from 'node:test';
import assert from 'node:assert/strict';
import { assertJobTransition, canTransitionJob, JOB_TRANSITIONS } from '../../n8n/code/lib/state-machine.mjs';

test('reference state machine matches approval and terminal-state rules', () => {
  assert.equal(canTransitionJob('DRAFT_READY', 'APPROVED'), true);
  assert.equal(canTransitionJob('DRAFT_READY', 'PROVIDER_ACCEPTED'), false);
  assert.equal(canTransitionJob('APPROVED', 'SENDING'), true);
  for (const terminal of ['PROVIDER_ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED']) {
    assert.deepEqual(JOB_TRANSITIONS[terminal], []);
  }
  assert.equal(assertJobTransition('DRAFT_READY', 'APPROVED'), 'APPROVED');
  assert.throws(() => assertJobTransition('APPROVED', 'PROVIDER_ACCEPTED'), { code: 'JOB_TRANSITION_INVALID' });
});
