export class SafeStop extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SafeStop';
    this.code = code;
    this.details = details;
  }
}

export function asSafeResult(error) {
  if (error instanceof SafeStop) {
    return { ok: false, code: error.code, message: error.message, details: error.details };
  }
  return { ok: false, code: 'INTERNAL_ERROR', message: 'Unexpected dry-run failure', details: {} };
}
