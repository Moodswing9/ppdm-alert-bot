import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPpdmEvent, classifyNwEvent, isSuppressed } from "../src/classifier.js";

test("PPDM failed job is CRITICAL with the error message", () => {
  const a = classifyPpdmEvent({ state: "FAILED", assetName: "sql01", assetType: "MSSQL", error: { message: "disk full" } });
  assert.equal(a?.severity, "CRITICAL");
  assert.equal(a?.kind, "job_failed");
  assert.match(a!.title, /sql01/);
  assert.match(a!.body, /disk full/);
});

test("PPDM canceled job is WARNING", () => {
  const a = classifyPpdmEvent({ state: "CANCELED", assetName: "vm01" });
  assert.equal(a?.severity, "WARNING");
  assert.equal(a?.kind, "job_canceled");
});

test("PPDM succeeded job is INFO and reports GB transferred", () => {
  const a = classifyPpdmEvent({ state: "SUCCEEDED", assetName: "vm01", bytesTransferred: 2 * 1024 ** 3 });
  assert.equal(a?.severity, "INFO");
  assert.match(a!.body, /2\.00 GB/);
});

test("PPDM state is case-insensitive and falls back to status", () => {
  assert.equal(classifyPpdmEvent({ status: "failed" })?.severity, "CRITICAL");
});

test("PPDM non-JOB events and unknown states are ignored", () => {
  assert.equal(classifyPpdmEvent({ classType: "ALERT", state: "FAILED" }), null);
  assert.equal(classifyPpdmEvent({ state: "RUNNING" }), null);
});

test("NetWorker failed save set (status or code 1) is CRITICAL", () => {
  assert.equal(classifyNwEvent({ status: "failed", clientName: "c1" })?.severity, "CRITICAL");
  assert.equal(classifyNwEvent({ completionCode: 1 })?.kind, "job_failed");
});

test("NetWorker interrupted save set (status or code 2) is WARNING", () => {
  assert.equal(classifyNwEvent({ status: "interrupted" })?.severity, "WARNING");
  assert.equal(classifyNwEvent({ completionCode: 2 })?.severity, "WARNING");
});

test("NetWorker success is ignored", () => {
  assert.equal(classifyNwEvent({ status: "succeeded" }), null);
});

test("ALERT_FAILED_JOBS=false suppresses only failed-job alerts", () => {
  const failed = classifyPpdmEvent({ state: "FAILED" })!;
  const nwFailed = classifyNwEvent({ status: "failed" })!;
  const canceled = classifyPpdmEvent({ state: "CANCELED" })!;
  const off = { ALERT_FAILED_JOBS: "false" };
  assert.equal(isSuppressed(failed, off), true);
  assert.equal(isSuppressed(nwFailed, off), true);
  assert.equal(isSuppressed(canceled, off), false);
  assert.equal(isSuppressed(failed, {}), false);
  assert.equal(isSuppressed(failed, { ALERT_FAILED_JOBS: "true" }), false);
});
