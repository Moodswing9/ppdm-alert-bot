import fs from "fs";
import https from "https";

/**
 * Build the HTTPS agent for one appliance, configured from environment
 * variables named after its prefix (here always PPDM):
 *
 *   <PREFIX>_CA_FILE       PEM file with the CA (or the appliance's own
 *                          self-signed certificate) to trust. Certificates
 *                          are still verified, against this CA.
 *   <PREFIX>_TLS_INSECURE  "true" turns certificate verification off.
 *                          Only for labs: credentials can then be
 *                          intercepted. A warning is printed on every use.
 *
 * With neither set, certificates are verified against Node's trusted CAs
 * (plus NODE_EXTRA_CA_CERTS, if set).
 */
export function tlsAgent(prefix: string, env: NodeJS.ProcessEnv = process.env): https.Agent {
  const insecureVar = `${prefix}_TLS_INSECURE`;
  const caVar = `${prefix}_CA_FILE`;
  const insecureRaw = (env[insecureVar] ?? "").trim().toLowerCase();
  const caFile = env[caVar]?.trim();

  if (insecureRaw !== "" && !["true", "false", "1", "0"].includes(insecureRaw)) {
    throw new Error(`${insecureVar} must be "true" or "false", got "${env[insecureVar]}"`);
  }
  const insecure = insecureRaw === "true" || insecureRaw === "1";

  if (insecure) {
    if (caFile) throw new Error(`Set either ${caVar} or ${insecureVar}, not both`);
    // stderr: stdout carries the MCP protocol.
    console.error(
      `WARNING: ${insecureVar}=true - TLS certificate verification is OFF for ${prefix}. ` +
        `Credentials sent to this host can be intercepted. Use ${caVar} instead.`,
    );
    // Deliberate, explicit opt-in (see above); verification is on by default.
    return new https.Agent({ rejectUnauthorized: false });
  }

  if (caFile) {
    let ca: Buffer;
    try {
      ca = fs.readFileSync(caFile);
    } catch (err) {
      throw new Error(`${caVar}: cannot read "${caFile}": ${(err as Error).message}`);
    }
    return new https.Agent({ ca });
  }

  return new https.Agent();
}
