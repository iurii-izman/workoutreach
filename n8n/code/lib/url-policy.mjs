import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { SafeStop } from './errors.mjs';

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.home', '.lan'];

function ipText(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

export function assertPublicAddress(address) {
  let parsed;
  try {
    parsed = ipaddr.process(address);
  } catch {
    throw new SafeStop('URL_DNS_INVALID', 'DNS returned an invalid IP address');
  }
  if (parsed.range() !== 'unicast') {
    throw new SafeStop('URL_ADDRESS_BLOCKED', 'Resolved address is not globally routable', { range: parsed.range() });
  }
  return parsed.toString();
}

export function normalizeUrl(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new SafeStop('URL_REQUIRED', 'Exactly one URL is required');
  }
  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new SafeStop('URL_INVALID', 'URL could not be parsed');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) throw new SafeStop('URL_SCHEME_BLOCKED', 'Only HTTP and HTTPS are allowed');
  if (parsed.username || parsed.password) throw new SafeStop('URL_USERINFO_BLOCKED', 'URL userinfo is forbidden');
  if (parsed.hash) throw new SafeStop('URL_FRAGMENT_BLOCKED', 'URL fragments are forbidden');
  if (parsed.port && !['80', '443'].includes(parsed.port)) throw new SafeStop('URL_PORT_BLOCKED', 'Only ports 80 and 443 are allowed');

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (!hostname || hostname === 'localhost' || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new SafeStop('URL_HOST_BLOCKED', 'Local and internal hostnames are forbidden');
  }
  if (ipaddr.isValid(ipText(hostname))) throw new SafeStop('URL_LITERAL_IP_BLOCKED', 'Literal IP addresses are forbidden');

  parsed.hostname = hostname;
  parsed.hash = '';
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) parsed.port = '';
  return parsed;
}

export function assertSameSite(candidate, root) {
  const normalized = normalizeUrl(candidate instanceof URL ? candidate.href : candidate);
  if (normalized.hostname !== root.hostname) throw new SafeStop('URL_CROSS_SITE_BLOCKED', 'Cross-site navigation is forbidden');
  return normalized;
}

export async function resolvePublicHost(hostname, lookup = dns.lookup) {
  let results;
  try {
    results = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SafeStop('URL_DNS_FAILED', 'Hostname could not be resolved');
  }
  if (!Array.isArray(results) || results.length === 0) throw new SafeStop('URL_DNS_EMPTY', 'Hostname has no A or AAAA records');
  const publicResults = [];
  let firstBlocked = null;
  for (const entry of results) {
    try {
      publicResults.push({ address: assertPublicAddress(entry.address), family: entry.family });
    } catch (error) {
      if (!(error instanceof SafeStop) || error.code !== 'URL_ADDRESS_BLOCKED') throw error;
      firstBlocked ??= error;
    }
  }
  if (publicResults.length === 0) throw firstBlocked ?? new SafeStop('URL_DNS_EMPTY', 'Hostname has no public A or AAAA records');
  return publicResults;
}
