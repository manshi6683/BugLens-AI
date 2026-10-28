
const test = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL =
  process.env.BUGLENS_TEST_BASE_URL || "http://localhost:5000";

async function postJson(path, data) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

test("Rejects bug report without required fields", async () => {
  const response = await postJson("/api/bug-reports", {});
  assert.equal(response.status, 400);

  const body = await response.json();
  assert.equal(body.success, false);
});

test("Rejects unsupported bug status", async () => {
  const response = await postJson("/api/bug-reports", {
    reportId: "LIFECYCLE-INVALID-001",
    testName: "Lifecycle validation test",
    status: "INVALID",
  });

  assert.equal(response.status, 400);
});

test("Creates a bug report with OPEN status", async () => {
  const response = await postJson("/api/bug-reports", {
    reportId: "LIFECYCLE-TEST-001",
    testName: "Required field validation failed",
    message: "Test bug created by automated regression test",
    status: "OPEN",
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.severity, "Medium");
  assert.equal(body.priority, "P3");

  const listResponse = await fetch(`${BASE_URL}/api/bug-reports`);
  const listBody = await listResponse.json();

  const report = listBody.reports.find(
    (item) => item.report_id === "LIFECYCLE-TEST-001"
  );

  assert.ok(report, "Created report should exist");
  assert.equal(report.status, "OPEN");
  assert.equal(report.resolved_at, null);
});

test("Resolves an existing OPEN bug report", async () => {
  const response = await postJson("/api/bug-reports/resolve", {
    reportId: "LIFECYCLE-TEST-001",
    testName: "Required field validation failed",
    message: "Automated test confirms the bug is fixed",
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.resolved, true);

  const listResponse = await fetch(`${BASE_URL}/api/bug-reports`);
  const listBody = await listResponse.json();

  const report = listBody.reports.find(
    (item) => item.report_id === "LIFECYCLE-TEST-001"
  );

  assert.ok(report, "Resolved report should still exist");
  assert.equal(report.status, "RESOLVED");
  assert.ok(report.resolved_at, "Resolved report should have a timestamp");
});

test("Does not resolve a report that is already resolved", async () => {
  const response = await postJson("/api/bug-reports/resolve", {
    reportId: "LIFECYCLE-TEST-001",
    testName: "Required field validation failed",
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.resolved, false);
});
