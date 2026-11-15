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
