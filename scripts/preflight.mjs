import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.find((value) => value.startsWith('--mode='))?.split('=')[1] ?? 'ci';
const stage = JSON.parse(await readFile(join(root, 'config/stage.json'), 'utf8'));
const template = JSON.parse(await readFile(join(root, 'templates/email/ru/v1/manifest.json'), 'utf8'));
const offer = JSON.parse(await readFile(join(root, 'product/offer-profile.v1.yaml'), 'utf8'));
const envExample = await readFile(join(root, '.env.example'), 'utf8');
const errors = [];

if (stage.live_send_enabled || stage.mail_transport !== 'disabled' || stage.outbox_implemented) errors.push('stage boundary permits sending');
if (template.sendable || !template.owner_approved) errors.push('owner-approved template boundary invalid');
if (offer.sendable || !offer.owner_approved || offer.claims.length === 0) errors.push('owner-approved offer boundary invalid');
if (template.allowed_placeholders.length !== 2 || !template.allowed_placeholders.includes('COMPANY_NAME') || !template.allowed_placeholders.includes('PERSONALIZATION_PHRASE')) {
  errors.push('template placeholder boundary invalid');
}
if (!template.attachment?.required || template.attachment?.tracked_in_git !== false) errors.push('external CV attachment boundary invalid');
if (!/^LIVE_SEND_ENABLED=false$/mu.test(envExample) || !/^MAIL_TRANSPORT=disabled$/mu.test(envExample)) errors.push('.env.example safety defaults invalid');
if (process.env.LIVE_SEND_ENABLED?.toLowerCase() === 'true') errors.push('LIVE_SEND_ENABLED=true is forbidden');
if (process.env.MAIL_TRANSPORT && process.env.MAIL_TRANSPORT !== 'disabled') errors.push('mail transport must be disabled');
if (mode === 'production') errors.push('production preflight is intentionally locked until a later owner-approved stage');

if (errors.length) {
  console.error(JSON.stringify({ gate: 'preflight', mode, ok: false, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ gate: 'preflight', mode, ok: true, implementedStages: stage.implemented_stages, liveSend: false }, null, 2));
