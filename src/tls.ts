import fs from "fs";
import https from "https";

/**
 * Build the HTTPS agent for one appliance. Certificates are always verified.
 *
 *   <PREFIX>_CA_FILE   PEM file with the CA (or the appliance's own
 *                      self-signed certificate) to trust, where <PREFIX> is
 *                      its prefix (here always PPDM).
 *
 * Without it, certificates are verified against Node's trusted CAs (plus
 * NODE_EXTRA_CA_CERTS, if set). There is intentionally no way to turn
 * verification off: credentials are sent on these connections.
 */
export function tlsAgent(prefix: string, env: NodeJS.ProcessEnv = process.env): https.Agent {
  const caVar = `${prefix}_CA_FILE`;
  const caFile = env[caVar]?.trim();
  if (!caFile) return new https.Agent();

  let ca: Buffer;
  try {
    ca = fs.readFileSync(caFile);
  } catch (err) {
    throw new Error(`${caVar}: cannot read "${caFile}": ${(err as Error).message}`);
  }
  return new https.Agent({ ca });
}

const README_TLS = "https://github.com/Moodswing9/ppdm-alert-bot#tls-certificates";
const UNTRUSTED = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

/** A plain-English next step for a TLS error code, or undefined for other errors. */
export function tlsHint(code: string | undefined, prefix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!code) return undefined;
  if (UNTRUSTED.has(code)) {
    return env[`${prefix}_CA_FILE`]?.trim()
      ? `${prefix}'s TLS certificate is not signed by the certificate in ${prefix}_CA_FILE. Check that the file holds ${prefix}'s own certificate or its CA (${README_TLS})`
      : `${prefix}'s TLS certificate is not trusted. If it is self-signed, set ${prefix}_CA_FILE to its certificate (${README_TLS})`;
  }
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return `${prefix}'s TLS certificate does not match ${prefix}_HOST. Use the host name or IP the certificate was issued for`;
  }
  if (code === "CERT_HAS_EXPIRED") return `${prefix}'s TLS certificate has expired. Renew it on the appliance`;
  return undefined;
}

type WithInterceptors = { interceptors: { response: { use(ok: undefined, fail: (err: unknown) => unknown): unknown } } };

/** Append tlsHint() to the message of TLS errors from this HTTP client. Returns the client. */
export function withTlsHints<T extends WithInterceptors>(http: T, prefix: string, env: NodeJS.ProcessEnv = process.env): T {
  http.interceptors.response.use(undefined, (err: unknown) => {
    const e = err as { code?: string; message?: string };
    const hint = tlsHint(e?.code, prefix, env);
    if (hint && typeof e.message === "string" && !e.message.includes(hint)) e.message = `${e.message}. ${hint}`;
    return Promise.reject(err);
  });
  return http;
}
