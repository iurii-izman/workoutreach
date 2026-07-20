import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLiveAnalysisRuntime } from '../../n8n/code/lib/live-analysis.mjs';

test('live analysis accepts the physical mail-disabled runtime', () => {
  assert.deepEqual(assertLiveAnalysisRuntime({
    MAIL_TRANSPORT: 'disabled', LIVE_SEND_ENABLED: 'false', DAILY_SEND_LIMIT: '0',
  }), { liveSendEnabled: false, mailTransport: 'disabled', dailySendLimit: 0 });
});

test('live analysis accepts guarded SMTP without granting transmission authority', () => {
  assert.deepEqual(assertLiveAnalysisRuntime({
    MAIL_TRANSPORT: 'smtp', LIVE_SEND_ENABLED: 'true', DAILY_SEND_LIMIT: '1',
  }), { liveSendEnabled: true, mailTransport: 'smtp', dailySendLimit: 1 });
});

test('live analysis rejects inconsistent or excessive mail configuration', () => {
  assert.throws(() => assertLiveAnalysisRuntime({
    MAIL_TRANSPORT: 'smtp', LIVE_SEND_ENABLED: 'false', DAILY_SEND_LIMIT: '0',
  }), { code: 'MAIL_CONFIG_INVALID' });
  assert.throws(() => assertLiveAnalysisRuntime({
    MAIL_TRANSPORT: 'smtp', LIVE_SEND_ENABLED: 'true', DAILY_SEND_LIMIT: '20',
  }), { code: 'MAIL_CONFIG_INVALID' });
});
