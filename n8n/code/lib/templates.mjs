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
    if (/\r|\n/u.test(value)) throw new SafeStop('TEMPLATE_VALUE_CONTROL', 'Template value contains a forbidden line break', { name });
    return html ? escapeHtml(value) : value;
  });
}

export async function loadTemplate(root, version = 'v3') {
  if (!['v2', 'v3'].includes(version)) throw new SafeStop('TEMPLATE_VERSION_INVALID', 'Unsupported career template version');
  const base = join(root, `templates/email/ru/${version}`);
  const [manifestRaw, subject, bodyText, bodyHtml] = await Promise.all([
    readFile(join(base, 'manifest.json'), 'utf8'),
    readFile(join(base, 'subject.txt'), 'utf8'),
    readFile(join(base, 'body.txt'), 'utf8'),
    readFile(join(base, 'body.html'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestRaw);
  if (!Array.isArray(manifest.allowed_placeholders) || !Array.isArray(manifest.required_placeholders)) {
    throw new SafeStop('TEMPLATE_PLACEHOLDER_POLICY', 'Career template placeholder policy is invalid');
  }
  if (typeof manifest.universal_opening !== 'string' || manifest.universal_opening.length < 40 || /[\r\n]/u.test(manifest.universal_opening)) {
    throw new SafeStop('TEMPLATE_UNIVERSAL_OPENING_INVALID', 'Career template requires one owner-approved universal opening paragraph');
  }
  const combined = `${subject}\n${bodyText}\n${bodyHtml}`;
  const found = [...combined.matchAll(PLACEHOLDER)].map((match) => match[1]);
  if (manifest.content_policy === 'fixed_universal_no_placeholders') {
    if (manifest.allowed_placeholders.length !== 0 || manifest.required_placeholders.length !== 0 || found.length !== 0) {
      throw new SafeStop('TEMPLATE_PLACEHOLDER_POLICY', 'Fixed universal template must not expose placeholders');
    }
    if (!bodyText.includes(manifest.universal_opening) || !bodyHtml.includes(manifest.universal_opening)) {
      throw new SafeStop('TEMPLATE_UNIVERSAL_OPENING_INVALID', 'Fixed universal opening must be literal in both body variants');
    }
  } else if (manifest.allowed_placeholders.length !== 1 || manifest.allowed_placeholders[0] !== 'OPENING_PARAGRAPH') {
    throw new SafeStop('TEMPLATE_PLACEHOLDER_POLICY', 'Personalization-capable template may expose only the reviewed opening paragraph placeholder');
  }
  for (const required of manifest.required_placeholders) {
    if (!combined.includes(`{{${required}}}`)) {
      throw new SafeStop('TEMPLATE_PLACEHOLDER_MISSING', 'Template set is missing a required placeholder', { required });
    }
  }
  return { manifest, subject, bodyText, bodyHtml, hash: sha256(stableJson({ manifest, subject, bodyText, bodyHtml })) };
}

export function renderDraft(template, values) {
  const extraValues = Object.keys(values).filter((name) => !template.manifest.allowed_placeholders.includes(name));
  if (extraValues.length) throw new SafeStop('TEMPLATE_VALUE_UNKNOWN', 'Template received a value outside its placeholder contract', { extraValues });
  return {
    subject: renderOne(template.subject, values, template.manifest).trim(),
    body_text: renderOne(template.bodyText, values, template.manifest).trim(),
    body_html: renderOne(template.bodyHtml, values, template.manifest, true).trim(),
    template_version: template.manifest.version,
    template_sha256: template.hash,
    attachment: {
      ...template.manifest.attachment,
      status: 'NOT_VALIDATED',
    },
    sendable: template.manifest.sendable === true && template.manifest.owner_approved === true,
  };
}
