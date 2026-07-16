import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SafeStop } from './errors.mjs';
import { sha256, stableJson } from './normalize.mjs';

const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/gu;

function escapeHtml(value) {
  return String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}

function renderOne(template, values, manifest, html = false) {
  const found = [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
  const unknown = found.filter((name) => !manifest.allowed_placeholders.includes(name));
  if (unknown.length) throw new SafeStop('TEMPLATE_PLACEHOLDER_UNKNOWN', 'Template contains an unknown placeholder', { unknown });
  return template.replace(PLACEHOLDER, (_whole, name) => {
    if (!(name in values)) throw new SafeStop('TEMPLATE_VALUE_MISSING', 'Template value is missing', { name });
    const value = String(values[name]);
    if (/\r|\n/u.test(value) && name !== 'PERSONALIZATION_PHRASE') throw new SafeStop('TEMPLATE_VALUE_CONTROL', 'Template value contains a forbidden line break', { name });
    return html ? escapeHtml(value) : value;
  });
}

export async function loadTemplate(root) {
  const base = join(root, 'templates/email/ru/v1');
  const [manifestRaw, subject, bodyText, bodyHtml] = await Promise.all([
    readFile(join(base, 'manifest.json'), 'utf8'),
    readFile(join(base, 'subject.txt'), 'utf8'),
    readFile(join(base, 'body.txt'), 'utf8'),
    readFile(join(base, 'body.html'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestRaw);
  for (const required of manifest.required_placeholders) {
    if (!`${subject}\n${bodyText}\n${bodyHtml}`.includes(`{{${required}}}`)) {
      throw new SafeStop('TEMPLATE_PLACEHOLDER_MISSING', 'Template set is missing a required placeholder', { required });
    }
  }
  return { manifest, subject, bodyText, bodyHtml, hash: sha256(stableJson({ manifest, subject, bodyText, bodyHtml })) };
}

export function renderDraft(template, values) {
  return {
    subject: renderOne(template.subject, values, template.manifest).trim(),
    body_text: renderOne(template.bodyText, values, template.manifest).trim(),
    body_html: renderOne(template.bodyHtml, values, template.manifest, true).trim(),
    template_version: template.manifest.version,
    template_sha256: template.hash,
    sendable: template.manifest.sendable === true && template.manifest.owner_approved === true,
  };
}
