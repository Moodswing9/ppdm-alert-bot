export type Severity = "CRITICAL" | "WARNING" | "INFO";

export interface Alert {
  severity: Severity;
  title: string;
  body: string;
  source: "PPDM" | "NetWorker";
  raw: Record<string, unknown>;
}

export function classifyPpdmEvent(payload: Record<string, unknown>): Alert | null {
  const state     = String(payload.state ?? payload.status ?? "").toUpperCase();
  const assetName = String(payload.assetName ?? payload.name ?? "unknown");
  const assetType = String(payload.assetType ?? "");
  const error     = (payload.error as { message?: string })?.message ?? String(payload.errorCode ?? "");
  const classType = String(payload.classType ?? "JOB");

  if (classType !== "JOB") return null;

  if (state === "FAILED") {
    return {
      severity: "CRITICAL",
      title: `Backup FAILED — ${assetName}`,
      body: [
        `Asset: ${assetName} (${assetType})`,
        `Error: ${error || "unknown"}`,
        `Time:  ${payload.startTime ?? "unknown"}`,
      ].join("\n"),
      source: "PPDM",
      raw: payload,
    };
  }

  if (state === "CANCELED") {
    return {
      severity: "WARNING",
      title: `Backup CANCELED — ${assetName}`,
      body: `Asset: ${assetName} (${assetType})\nTime: ${payload.startTime ?? "unknown"}`,
      source: "PPDM",
      raw: payload,
    };
  }

  if (state === "SUCCEEDED") {
    const bytes = Number(payload.bytesTransferred ?? 0);
    const gb    = bytes > 0 ? ` | ${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB` : "";
    return {
      severity: "INFO",
      title: `Backup succeeded — ${assetName}`,
      body: `Asset: ${assetName} (${assetType})${gb}\nDuration: ${payload.duration ?? "unknown"}s`,
      source: "PPDM",
      raw: payload,
    };
  }

  return null;
}

export function classifyNwEvent(payload: Record<string, unknown>): Alert | null {
  const status     = String(payload.status ?? payload.completionCode ?? "").toLowerCase();
  const clientName = String(payload.clientName ?? payload.name ?? "unknown");
  const saveSetName = String(payload.saveSetName ?? payload.ssid ?? "");

  if (status === "failed" || status === "1") {
    return {
      severity: "CRITICAL",
      title: `NetWorker saveset FAILED — ${clientName}`,
      body: [
        `Client:   ${clientName}`,
        `Save set: ${saveSetName}`,
        `Message:  ${payload.completionMessage ?? "unknown"}`,
        `Time:     ${payload.saveTime ?? "unknown"}`,
      ].join("\n"),
      source: "NetWorker",
      raw: payload,
    };
  }

  if (status === "interrupted" || status === "2") {
    return {
      severity: "WARNING",
      title: `NetWorker saveset interrupted — ${clientName}`,
      body: `Client: ${clientName}\nSave set: ${saveSetName}`,
      source: "NetWorker",
      raw: payload,
    };
  }

  return null;
}
