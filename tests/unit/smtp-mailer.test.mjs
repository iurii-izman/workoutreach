import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../../n8n/code/lib/normalize.mjs';
import { createSmtpMailerFromEnv } from '../../n8n/code/lib/smtp-mailer.mjs';

test('SMTP mailer verifies TLS config and sends one validated CV without network in tests', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'workoutreach-smtp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filename = 'approved-cv.pdf';
  const path = join(directory, filename);
  const contents = Buffer.from('%PDF-1.7\nsynthetic-mail-test\n%%EOF\n');
  await writeFile(path, contents);
  let transportConfig;
  let sent;
  const transport = {
    async verify() { return true; },
    async sendMail(message) { sent = message; return { accepted: ['recipient@example.com'], rejected: [], messageId: '<synthetic@example.com>' }; },
    close() {},
  };
  const env = {
    SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'sender@example.com', SMTP_PASSWORD: 'app-password',
    MAIL_FROM_ADDRESS: 'sender@example.com', MAIL_FROM_NAME: 'Юрий Изман',
    CV_ATTACHMENT_PATH: path, CV_ATTACHMENT_FILENAME: filename, CV_ATTACHMENT_SHA256: sha256(contents),
  };
  const mailer = createSmtpMailerFromEnv(env, { createTransport(config) { transportConfig = config; return transport; } });
  await mailer.verify();
  const result = await mailer.sendDraft({ recipient_email: 'recipient@example.com', subject: 'Subject', body_text: 'Text', body_html: '<p>Text</p>', attachment_sha256: sha256(contents) });
  assert.equal(transportConfig.secure, true);
  assert.equal(transportConfig.tls.minVersion, 'TLSv1.2');
  assert.equal(sent.attachments[0].path, path);
  assert.equal(result.messageId, '<synthetic@example.com>');
});
