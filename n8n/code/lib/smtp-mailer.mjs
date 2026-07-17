import nodemailer from 'nodemailer';
import { validateConfiguredCv } from './attachments.mjs';
import { SafeStop } from './errors.mjs';

function required(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized === 'disabled') throw new SafeStop(code, 'Required SMTP configuration is missing');
  return normalized;
}

function email(value, code) {
  const normalized = required(value, code).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) throw new SafeStop(code, 'Configured SMTP address is invalid');
  return normalized;
}

export function createSmtpMailerFromEnv(env = process.env, { createTransport = nodemailer.createTransport } = {}) {
  const host = required(env.SMTP_HOST, 'SMTP_HOST_MISSING');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu.test(host)) throw new SafeStop('SMTP_HOST_INVALID', 'SMTP host must be a DNS hostname');
  const port = Number(env.SMTP_PORT ?? 465);
  if (![465, 587].includes(port)) throw new SafeStop('SMTP_PORT_BLOCKED', 'Only SMTP submission ports 465 and 587 are allowed');
  const user = required(env.SMTP_USER, 'SMTP_USER_MISSING');
  const pass = required(env.SMTP_PASSWORD, 'SMTP_PASSWORD_MISSING');
  const fromAddress = email(env.MAIL_FROM_ADDRESS, 'MAIL_FROM_INVALID');
  const fromName = String(env.MAIL_FROM_NAME ?? 'Юрий Изман').trim().slice(0, 120);
  const replyTo = env.MAIL_REPLY_TO ? email(env.MAIL_REPLY_TO, 'MAIL_REPLY_TO_INVALID') : fromAddress;
  const transporter = createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: host },
  });

  return {
    async verify() { await transporter.verify(); return true; },
    async sendDraft(draft) {
      const attachment = await validateConfiguredCv(env);
      if (draft.attachment_sha256 && draft.attachment_sha256 !== attachment.sha256) throw new SafeStop('ATTACHMENT_DRAFT_MISMATCH', 'Draft attachment hash no longer matches the validated CV');
      const info = await transporter.sendMail({
        from: { name: fromName, address: fromAddress },
        replyTo,
        to: email(draft.recipient_email, 'RECIPIENT_EMAIL_INVALID'),
        subject: String(draft.subject),
        text: String(draft.body_text),
        html: String(draft.body_html),
        attachments: [{ filename: attachment.filename, path: env.CV_ATTACHMENT_PATH, contentType: 'application/pdf' }],
        headers: { 'X-Auto-Response-Suppress': 'OOF, AutoReply' },
      });
      if (!Array.isArray(info.accepted) || info.accepted.length < 1 || (info.rejected?.length ?? 0) > 0) throw new SafeStop('SMTP_RECIPIENT_REJECTED', 'SMTP server did not accept the recipient');
      const messageId = String(info.messageId ?? '').trim();
      if (!messageId || messageId.length > 500) throw new SafeStop('SMTP_MESSAGE_ID_INVALID', 'SMTP response did not include a safe message identifier');
      return { messageId };
    },
    close() { transporter.close?.(); },
  };
}
