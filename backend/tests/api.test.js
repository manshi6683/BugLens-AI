
const test = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL =
  process.env.BUGLENS_TEST_BASE_URL || "http://localhost:5000";

test("API health endpoint returns success", async () => {
  const response = await fetch(`${BASE_URL}/api/health`);

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.success, true);
});

test("Bug reports API returns a valid reports array", async () => {
  const response = await fetch(`${BASE_URL}/api/bug-reports`);

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.reports));

  for (const report of body.reports) {
    assert.ok(report.report_id);
    assert.ok(report.test_name);
    assert.ok(["OPEN", "RESOLVED", "FAIL"].includes(report.status));
    assert.ok(["Critical", "High", "Medium", "Low"].includes(report.severity));
    assert.ok(["P1", "P2", "P3", "P4"].includes(report.priority));
  }
});

test("Form regression scan passes all seven demo checks", async () => {
  const demoUrl =
    process.env.BUGLENS_DEMO_URL || "http://localhost:5173/";

  const response = await fetch(`${BASE_URL}/api/form-tests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: demoUrl }),
  });

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.result.status, "completed");
  assert.equal(body.result.summary.formsFound, 2);
  assert.equal(body.result.summary.checksPassed, 7);
  assert.equal(body.result.summary.checksFailed, 0);
  assert.equal(body.result.summary.checksInfo, 0);
  assert.equal(body.bugReportSync.reportsOpened, 0);
});

test("Rejects invalid website URL", async () => {
  const response = await fetch(`${BASE_URL}/api/form-tests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "not-a-valid-url" }),
  });

  assert.equal(response.status, 400);

  const body = await response.json();
  assert.equal(body.success, false);
});

test("Screenshot endpoint returns 404 for a missing screenshot", async () => {
  const response = await fetch(
    `${BASE_URL}/reports/__missing_test_screenshot__.png`,
    { method: "HEAD" }
  );

  assert.equal(response.status, 404);
});