$ErrorActionPreference = 'Stop'
throw 'Export is intentionally locked until the first credential-free import is owner-reviewed. Use n8n CLI export to a temporary ignored directory, sanitize IDs/credentials/pin data, then run validate-workflows.mjs.'
