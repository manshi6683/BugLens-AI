import ExcelJS from "exceljs";
import { useEffect, useState } from "react";
import "./index.css";

const API_URL = "http://localhost:5000";

function StatCard({ label, value, icon, tone = "" }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div>
        <p className="stat-label">{label}</p>
        <h2 className="stat-value">{value ?? 0}</h2>
      </div>
    </div>
  );
}

function App() {
  const [url, setUrl] = useState("https://example.com");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scanHistory, setScanHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState("");
  const [formTestResult, setFormTestResult] = useState(null);
  const [formTestLoading, setFormTestLoading] = useState(false);
  const [formTestError, setFormTestError] = useState("");
  const [savedBugReports, setSavedBugReports] = useState([]);
  const [bugReportsLoading, setBugReportsLoading] = useState(false);
  const [bugReportsError, setBugReportsError] = useState("");
  const [severityFilter, setSeverityFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [expandedBugReportId, setExpandedBugReportId] = useState(null);
  const [bugReportSearch, setBugReportSearch] = useState("");
  const [bugReportSort, setBugReportSort] = useState("newest");
  async function startScan(event) {
    event.preventDefault();
    setError("");
    setResult(null);

    let parsedUrl;

    try {
      parsedUrl = new URL(url.trim());

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Enter a valid HTTP or HTTPS website URL.");
      }
    } catch {
      setError("Please enter a valid website URL, including https://");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: parsedUrl.href }),
      });

      const data = await response.json();

      if (!response.ok || !data.result) {
        throw new Error(data.message || data.result?.error || "Scan failed.");
      }

      setResult(data.result);
      loadHistory();

      if (data.result.status !== "completed") {
        setError(data.result.error || "The scan could not be completed.");
      }
    } catch (err) {
      setError(
        err.message === "Failed to fetch"
          ? "Cannot connect to the backend. Make sure server.js is running on port 5000."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.summary;
  const failedFormTests = (formTestResult?.tests || []).filter(
    (test) => test.status === "FAIL"
  );
  const issueIcon = {
    "JavaScript Error": "JS",
    "Console Error": "!",
    "Failed Request": "↗",
    "HTTP Error": "HTTP",
    "Missing Image": "IMG",
    "Suspicious Link": "URL",
  };


  async function downloadWorkbook(workbook, filename) {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  function styleWorksheet(worksheet) {
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF263B63" },
    };
    worksheet.getRow(1).alignment = { vertical: "top", wrapText: true };
    worksheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
  }

  async function exportReport() {
    if (!result) return;

    const summary = result.summary || {};
    const issues = result.issues || [];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "BugLens AI";
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet("Executive Summary");
    summarySheet.addRows([
      ["BugLens AI - Website Scan Report"],
      ["Website URL", result.url],
      ["Scan Date", result.scannedAt ? new Date(result.scannedAt).toLocaleString() : "Not available"],
      ["Scan Status", result.status || "unknown"],
      ["Total Issues", summary.totalIssues ?? issues.length],
      ["Broken Links", summary.brokenLinks ?? 0],
      ["Console Errors", summary.consoleErrors ?? 0],
      ["Failed Requests", summary.failedRequests ?? 0],
      ["Missing Images", summary.missingImages ?? 0],
      ["Screenshot Path", result.screenshot || "Not available"],
    ]);
    summarySheet.columns = [{ width: 28 }, { width: 75 }];
    styleWorksheet(summarySheet);

    const issueSheet = workbook.addWorksheet("Bug Details");
    issueSheet.columns = [
      { header: "Issue ID", key: "id", width: 14 },
      { header: "Issue Type", key: "type", width: 22 },
      { header: "Severity", key: "severity", width: 16 },
      { header: "Description", key: "description", width: 55 },
      { header: "Affected Page", key: "page", width: 38 },
      { header: "Resource URL", key: "resource", width: 45 },
      { header: "HTTP Status", key: "httpStatus", width: 14 },
      { header: "Reproduction Steps", key: "steps", width: 60 },
      { header: "Scan Date", key: "date", width: 24 },
    ];
    issues.forEach((issue, index) => {
      issueSheet.addRow({
        id: `BUG-${String(index + 1).padStart(3, "0")}`,
        type: issue.type || "Unclassified",
        severity: issue.severity || "Unclassified",
        description: issue.message || "",
        page: issue.url || result.url,
        resource: issue.resourceUrl || "",
        httpStatus: issue.httpStatus ?? "",
        steps: `1. Open ${issue.url || result.url}\n2. Locate the affected resource\n3. Observe: ${issue.message || issue.type || "the issue"}`,
        date: result.scannedAt ? new Date(result.scannedAt).toLocaleString() : "Not available",
      });
    });
    styleWorksheet(issueSheet);

    await downloadWorkbook(
      workbook,
      `BugLens_Report_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }

  async function exportFormTestReport() {
    if (!formTestResult) return;

    const formSummary = formTestResult.summary || {};
    const tests = formTestResult.tests || [];
    const testedAt = formTestResult.testedAt
      ? new Date(formTestResult.testedAt).toLocaleString()
      : new Date().toLocaleString();
    const formUrl = formTestResult.url || url;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "BugLens AI";
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet("Executive Summary");
    summarySheet.addRows([
      ["BugLens AI - Automated Form Testing Report"],
      ["Website URL", formUrl],
      ["Test Date", testedAt],
      ["Test Status", formTestResult.status || "unknown"],
      ["Forms Found", formSummary.formsFound ?? 0],
      ["Checks Passed", formSummary.checksPassed ?? tests.filter((test) => test.status === "PASS").length],
      ["Checks Failed", formSummary.checksFailed ?? tests.filter((test) => test.status === "FAIL").length],
      ["Informational Checks", formSummary.checksInfo ?? tests.filter((test) => test.status === "INFO").length],
      [],
      ["Important Note", "PASS may indicate a validation rule was configured or a browser-native check passed. It does not guarantee server-side validation or the complete form workflow."],
    ]);
    summarySheet.columns = [{ width: 28 }, { width: 105 }];
    styleWorksheet(summarySheet);

    const detailsSheet = workbook.addWorksheet("Detailed Test Results");

    detailsSheet.columns = [
      { header: "Test ID", key: "id", width: 14 },
      { header: "Test Name", key: "name", width: 38 },
      { header: "Status", key: "status", width: 14 },
      { header: "Severity", key: "severity", width: 16 },
      { header: "Priority", key: "priority", width: 14 },
      { header: "Message", key: "message", width: 75 },
      { header: "Details", key: "details", width: 45 },
      { header: "Website URL", key: "url", width: 42 },
      { header: "Test Date", key: "date", width: 24 },
    ];

    if (tests.length) {
      tests.forEach((test, index) => detailsSheet.addRow({
        id: `FORM-${String(index + 1).padStart(3, "0")}`,
        name: test.name || "Unnamed test",
        status: test.status || "INFO",
        message: test.message || "",
        details: test.details ? JSON.stringify(test.details) : "",
        url: formUrl,
        date: testedAt,
      }));
    } else {
      detailsSheet.addRow({
        name: "No test results",
        status: "INFO",
        severity:
          test.status === "FAIL" ? "Medium" : "Not Applicable",
        priority:
          test.status === "FAIL" ? "P3" : "Not Applicable",
        message: "No detailed tests were returned.",
        url: formUrl,
        date: testedAt
      });
    }
    styleWorksheet(detailsSheet);

    const recommendations = [];
    tests.forEach((test) => {
      if (test.status === "FAIL") {
        recommendations.push({
          priority: "P2",
          test: test.name || "Unnamed test",
          recommendation: test.message || "Investigate the failed validation check.",
        });
      } else if (test.status === "INFO") {
        recommendations.push({
          priority: "Review",
          test: test.name || "Unnamed test",
          recommendation: test.message || "Review whether this validation rule is required by the product specification.",
        });
      }
    });
    if (!recommendations.length) {
      recommendations.push({
        priority: "Review",
        test: "Coverage limitation",
        recommendation: "Review the form against its requirements. This report inspects detected HTML/browser validation rules; it does not verify server-side validation or prove that real submissions succeed.",
      });
    }

    const recommendationsSheet = workbook.addWorksheet("Recommendations");
    recommendationsSheet.columns = [
      { header: "Priority", key: "priority", width: 14 },
      { header: "Related Test", key: "test", width: 38 },
      { header: "Recommendation", key: "recommendation", width: 105 },
    ];
    recommendations.forEach((item) => recommendationsSheet.addRow(item));
    styleWorksheet(recommendationsSheet);

    await downloadWorkbook(
      workbook,
      `BugLens_Form_Test_Report_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await fetch(`${API_URL}/api/scans?limit=20`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error("Could not load scan history.");
      }

      setScanHistory(data.scans);
    } catch (error) {
      setHistoryError(error.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadBugReports() {
    setBugReportsLoading(true);
    setBugReportsError("");

    try {
      const response = await fetch(`${API_URL}/api/bug-reports`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load bug reports.");
      }

      setSavedBugReports(data.reports || []);
    } catch (error) {
      setBugReportsError(error.message);
    } finally {
      setBugReportsLoading(false);
    }
  }

  const filteredBugReports = savedBugReports.filter((report) => {
    const searchTerm = bugReportSearch.trim().toLowerCase();

    const matchesSearch =
      !searchTerm ||
      (report.report_id || "").toLowerCase().includes(searchTerm) ||
      (report.test_name || "").toLowerCase().includes(searchTerm) ||
      (report.message || "").toLowerCase().includes(searchTerm);

    const matchesSeverity =
      severityFilter === "All" || report.severity === severityFilter;

    const matchesPriority =
      priorityFilter === "All" || report.priority === priorityFilter;

    const matchesStatus =
      statusFilter === "All" || report.status === statusFilter;

    return (
      matchesSearch &&
      matchesSeverity &&
      matchesPriority &&
      matchesStatus
    );
  });


  const sortedBugReports = [...filteredBugReports].sort((a, b) => {
    if (bugReportSort === "severity") {
      const severityRank = {
        Critical: 4,
        High: 3,
        Medium: 2,
        Low: 1,
      };

      return (
        (severityRank[b.severity || "Medium"] || 2) -
        (severityRank[a.severity || "Medium"] || 2)
      );
    }

    if (bugReportSort === "oldest") {
      return new Date(a.created_at) - new Date(b.created_at);
    }

    return new Date(b.created_at) - new Date(a.created_at);
  });



  async function saveFailedFormTests(result) {
    const tests = (result?.tests || []).filter(
      (test) => test.status === "FAIL" || test.status === "PASS"
    );

    for (const test of tests) {
      const reportId = [
        "FORM",
        result.url || url,
        test.name || "unnamed-test",
      ].join("|");

      const isFailed = test.status === "FAIL";

      const endpoint = isFailed
        ? `${API_URL}/api/bug-reports`
        : `${API_URL}/api/bug-reports/resolve`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId,
          testName: test.name || "Form test",
          message: test.message || "",
          screenshot: test.screenshot || null,
          ...(isFailed ? { status: "OPEN" } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not update bug report.");
      }
    }

    await loadBugReports();
  }


  async function openHistoryScan(id) {
    setError("");

    try {
      const response = await fetch(`${API_URL}/api/scans/${id}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not open scan.");
      }

      setResult({ ...data.result, id: data.id });
      document.getElementById("results")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch (error) {
      setError(error.message);
    }
  }

  useEffect(() => {
    loadHistory();
    loadBugReports();
  }, []);


  async function compareLatestScans() {
    setComparing(true);
    setCompareError("");
    setComparison(null);

    try {
      const historyResponse = await fetch(
        `${API_URL}/api/scans?limit=2`
      );

      const historyData = await historyResponse.json();

      if (!historyResponse.ok || !historyData.success) {
        throw new Error("Could not load scan history.");
      }

      const scans = historyData.scans;

      if (scans.length < 2) {
        throw new Error(
          "Please run at least two scans before comparing."
        );
      }

      // API history is ordered newest first.
      const latestScan = scans[0];
      const previousScan = scans[1];

      const [latestResponse, previousResponse] = await Promise.all([
        fetch(`${API_URL}/api/scans/${latestScan.id}`),
        fetch(`${API_URL}/api/scans/${previousScan.id}`),
      ]);

      const [latestData, previousData] = await Promise.all([
        latestResponse.json(),
        previousResponse.json(),
      ]);

      if (
        !latestResponse.ok ||
        !previousResponse.ok ||
        !latestData.success ||
        !previousData.success
      ) {
        throw new Error("Could not load both scan results.");
      }

      const latestIssues = latestData.result.issues || [];
      const previousIssues = previousData.result.issues || [];

      // Match issues using type, resource/page URL and message.
      // This is a first version of issue fingerprinting.
      function issueKey(issue) {
        return [
          issue.type || "",
          issue.resourceUrl || issue.url || "",
          (issue.message || "").trim().replace(/\s+/g, " ").toLowerCase(),
        ].join("|");
      }

      // Use queues so duplicate findings are compared correctly.
      const previousByKey = new Map();

      previousIssues.forEach((issue) => {
        const key = issueKey(issue);

        if (!previousByKey.has(key)) {
          previousByKey.set(key, []);
        }

        previousByKey.get(key).push(issue);
      });

      const newIssues = [];

      const persistentIssues = latestIssues.filter((issue) => {
        const matches = previousByKey.get(issueKey(issue));

        if (matches?.length) {
          matches.shift();
          return true;
        }

        newIssues.push(issue);
        return false;
      });

      const fixedIssues = [];

      previousByKey.forEach((remainingIssues) => {
        fixedIssues.push(...remainingIssues);
      });

      setComparison({
        previousScan,
        latestScan,
        newIssues,
        fixedIssues,
        persistentIssues,
      });
    } catch (error) {
      setCompareError(error.message);
    } finally {
      setComparing(false);
    }
  }

  async function runFormTests() {
    setFormTestLoading(true);
    setFormTestError("");
    setFormTestResult(null);

    try {
      const response = await fetch(`${API_URL}/api/form-tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();

      if (!response.ok || !data.result) {
        throw new Error(data.message || "Form testing failed.");
      }

      setFormTestResult(data.result);

      try {
        await saveFailedFormTests(data.result);
      } catch (saveError) {
        setBugReportsError(
          `Tests completed, but saving reports failed: ${saveError.message}`
        );
      }
    } catch (error) {
      setFormTestError(
        error.message === "Failed to fetch"
          ? "Cannot connect to backend. Check that port 5000 is running."
          : error.message
      );
    } finally {
      setFormTestLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home">
          <span className="brand-mark">B</span>
          <span>BugLens<span className="brand-ai"> AI</span></span>
        </a>

        <p className="nav-heading">WORKSPACE</p>
        <a className="nav-item active" href="#scanner">◈ <span>Website Scanner</span></a>
        <a className="nav-item" href="#results">▤ <span>Scan Results</span></a>
        <a className="nav-item" href="#how-it-works">◎ <span>How it works</span></a>

        <div className="sidebar-bottom">
          <span className="status-dot" />
          <span>Local scanner</span>
          <span className="online-label">READY</span>
        </div>
      </aside>

      <main className="main-content" id="home">
        <header className="topbar">
          <div>
            <p className="eyebrow">QUALITY ASSURANCE PLATFORM</p>
            <h1>Website Scanner</h1>
          </div>
          <div className="profile-badge">
            <span className="profile-avatar">QA</span>
            <span>QA Workspace</span>
          </div>
        </header>

        <section className="welcome-section" id="scanner">
          <div className="welcome-copy">
            <span className="pill"><span className="status-dot" /> AUTOMATED TESTING</span>
            <h2>Find bugs before<br />your users do.</h2>
            <p>
              Scan a website, capture evidence, and discover potential
              issues with your automated QA assistant.
            </p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="lens"><span /></div>
            <div className="art-chip chip-one">JS</div>
            <div className="art-chip chip-two">404</div>
            <div className="art-chip chip-three">✓</div>
          </div>
        </section>

        <section className="scan-panel">
          <div className="section-heading">
            <div>
              <h3>Start a new scan</h3>
              <p>Enter the URL of a website you own or have permission to test.</p>
            </div>
            <span className="engine-badge">● PLAYWRIGHT ENGINE</span>
          </div>

          <form className="scan-form" onSubmit={startScan}>
            <label htmlFor="website-url">WEBSITE URL</label>
            <div className="url-input-row">
              <span className="url-prefix">↗</span>
              <input
                id="website-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://yourwebsite.com"
                required
                disabled={loading}
              />
              <button className="scan-button" type="submit" disabled={loading}>
                {loading ? (
                  <><span className="spinner" /> Scanning...</>
                ) : (
                  <>▶ Start Scan</>
                )}
              </button>
            </div>
            <p className="form-hint">
              Checks browser errors, failed requests, HTTP responses and images.
            </p>
          </form>

          {error && (
            <div className="error-banner" role="alert">
              <strong>!</strong>
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div className="loading-panel" role="status">
              <span className="spinner large-spinner" />
              <div>
                <strong>Scanning your website</strong>
                <p>Opening Chromium and collecting browser diagnostics...</p>
              </div>
            </div>
          )}
        </section>

        <section className="form-test-panel">
          <div className="section-heading">
            <div>
              <h3>Automated Form Testing</h3>
              <p>Check native required-field and email validation.</p>
            </div>

            <div className="form-test-actions">
              <button
                className="scan-button"
                type="button"
                onClick={runFormTests}
                disabled={formTestLoading || loading}
              >
                {formTestLoading ? "Testing..." : "Run Form Tests"}
              </button>
              {formTestResult && (
                <button
                  className="export-button"
                  type="button"
                  onClick={exportFormTestReport}
                >
                  ↓ Export Form Report
                </button>
              )}
            </div>
          </div>

          {formTestError && (
            <div className="error-banner" role="alert">
              {formTestError}
            </div>
          )}

          {formTestResult && (
            <>
              <div className="stats-grid form-test-stats">
                <StatCard
                  label="Forms found"
                  value={formTestResult.summary.formsFound}
                  icon="▤"
                />
                <StatCard
                  label="Tests passed"
                  value={formTestResult.summary.checksPassed}
                  icon="✓"
                  tone="blue"
                />
                <StatCard
                  label="Tests failed"
                  value={formTestResult.summary.checksFailed}
                  icon="!"
                  tone="red"
                />
              </div>


              <div className="form-test-list">
                {formTestResult.tests.map((test, index) => (
                  <div className="form-test-row" key={`${test.name}-${index}`}>
                    <div className="form-test-details">
                      <strong>{test.name}</strong>
                      <p>{test.message}</p>

                      {test.status === "FAIL" && (
                        <div className="bug-report-details">
                          <p><strong>Bug ID:</strong> FORM-{String(index + 1).padStart(3, "0")}</p>
                          <p><strong>Expected:</strong> The form should follow its configured validation or submission behavior.</p>
                          <p><strong>Actual:</strong> {test.message}</p>
                          <p><strong>Severity:</strong> Medium — review the impact before assigning final severity.</p>
                          {test.details && (
                            <p><strong>Details:</strong> {JSON.stringify(test.details)}</p>
                          )}
                        </div>
                      )}

                      {test.screenshot && (
                        <p>
                          <a
                            href={`http://localhost:5000${test.screenshot}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View failure screenshot ↗
                          </a>
                        </p>
                      )}

                      {test.screenshotError && (
                        <p>Screenshot capture failed: {test.screenshotError}</p>
                      )}
                    </div>

                    <span className={`test-status ${test.status.toLowerCase()}`}>
                      {test.status}
                    </span>
                  </div>
                ))}
              </div>


              {formTestResult.tests.length === 0 && (
                <p className="form-test-empty">No test results were generated.</p>
              )}
            </>
          )}
        </section>
        <section className="bug-reports-section" id="bug-reports">
          <div className="bug-reports-header">
            <div>
              <h2>Bug Reports</h2>
              <p>Failed form tests and their available evidence.</p>
            </div>

            <span className="bug-report-count">
              {savedBugReports.length}{" "}
              {savedBugReports.length === 1 ? "Bug" : "Bugs"}
            </span>
          </div>

          <div className="bug-report-search">
            <input
              type="search"
              value={bugReportSearch}
              onChange={(event) => setBugReportSearch(event.target.value)}
              placeholder="Search by Bug ID, test name, or error message..."
              aria-label="Search bug reports"
            />
            {bugReportSearch && (
              <button
                type="button"
                className="export-button"
                onClick={() => setBugReportSearch("")}
              >
                Clear
              </button>
            )}
          </div>

          <div className="bug-report-sort">
            <label htmlFor="bug-report-sort">Sort by</label>
            <select
              id="bug-report-sort"
              value={bugReportSort}
              onChange={(event) => setBugReportSort(event.target.value)}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="severity">Highest Severity</option>
            </select>
          </div>

          <div className="bug-report-filters">
            <label>
              Severity
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
              >
                <option value="All">All Severities</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </label>

            <label>
              Priority
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
              >
                <option value="All">All Priorities</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
              </select>
            </label>

            <label>
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="All">All Statuses</option>
                <option value="OPEN">Open</option>
                <option value="RESOLVED">Resolved</option>
              </select>
            </label>
          </div>


          {bugReportsError ? (
            <p className="error-banner" role="alert">{bugReportsError}</p>
          ) : bugReportsLoading ? (
            <p>Loading saved bug reports...</p>

          ) : savedBugReports.length > 0 ? (
            filteredBugReports.length > 0 ? (
              <div className="bug-reports-list">

                {sortedBugReports.map((report) => (
                  <article className="bug-report-card" key={report.id}>
                    <div className="bug-report-card-header">
                      <div>
                        <span className="bug-report-id">
                          Database ID: {report.id}
                        </span>
                        <h3>{report.test_name}</h3>
                        <div className="bug-classification">
                          <span className={`severity-badge ${(report.severity || "Medium").toLowerCase()}`}>
                            Severity: {report.severity || "Medium"}
                          </span>
                          <span className="priority-badge">
                            Priority: {report.priority || "P3"}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`bug-report-status ${report.status === "RESOLVED" ? "resolved" : "open"
                          }`}
                      >
                        {report.status}
                      </span>
                    </div>

                    <p className="bug-report-message">
                      {report.message || "No error message provided."}
                    </p>

                    <div className="bug-report-details">
                      <span><strong>Report ID:</strong> {report.report_id}</span>
                      <span><strong>Created:</strong> {new Date(
                        report.created_at.endsWith("Z")
                          ? report.created_at
                          : `${report.created_at.replace(" ", "T")}Z`
                      ).toLocaleString()}</span>
                    </div>

                    <button
                      type="button"
                      className="export-button"
                      onClick={() =>
                        setExpandedBugReportId(
                          expandedBugReportId === report.id ? null : report.id
                        )
                      }
                      aria-expanded={expandedBugReportId === report.id}
                    >
                      {expandedBugReportId === report.id
                        ? "Hide Details −"
                        : "View Details +"}
                    </button>

                    {expandedBugReportId === report.id && (
                      <div className="bug-report-expanded-details">
                        <h4>Bug Report Details</h4>
                        <p>
                          <strong>Bug ID:</strong> {report.report_id}
                        </p>
                        <p>
                          <strong>Test Name:</strong> {report.test_name}
                        </p>
                        <p>
                          <strong>Severity:</strong> {report.severity || "Medium"}
                        </p>
                        <p>
                          <strong>Priority:</strong> {report.priority || "P3"}
                        </p>
                        <p>
                          <strong>Status:</strong> {report.status}
                        </p>
                        <p>
                          <strong>Actual Result:</strong>{" "}
                          {report.message || "No error details available."}
                        </p>
                        <p>
                          <strong>Evidence:</strong>{" "}
                          {report.screenshot
                            ? "Screenshot attached"
                            : "No screenshot available"}
                        </p>
                      </div>
                    )}

                    {report.screenshot && (
                      <div className="bug-report-evidence-preview">
                        <h4>Screenshot Evidence</h4>
                        <a
                          href={`${API_URL}${report.screenshot}`}
                          target="_blank"
                          rel="noreferrer"
                          className="bug-report-evidence"
                        >
                          <img
                            src={`${API_URL}${report.screenshot}`}
                            alt={`Failure evidence for ${report.test_name}`}
                            className="bug-report-screenshot"
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                          <span>View Full Screenshot ↗</span>
                        </a>
                      </div>
                    )}

                  </article>
                ))}
              </div>

            ) : (
              <div className="bug-report-empty">
                <div className="bug-report-empty-icon">✓</div>
                <h3>No reports match your filters</h3>
                <p>
                  Try selecting All for Severity, Priority, and Status.
                </p>
              </div>
            )
          ) : (
            <div className="bug-report-empty">
              <div className="bug-report-empty-icon">✓</div>
              <h3>No Saved Bug Reports</h3>
              <p>Run form tests. Any failed tests will appear here after saving.</p>
            </div>
          )}



        </section>
        <section className="results-section" id="results">

          <div className="results-heading">
            <div>
              <p className="eyebrow">SCAN OVERVIEW</p>
              <h3>{result ? "Latest scan results" : "Your scan results"}</h3>
            </div>

            <div className="results-actions">
              {result && (
                <>
                  <span className={`result-status ${result.status}`}>
                    ● {result.status === "completed"
                      ? "SCAN COMPLETED"
                      : "SCAN FAILED"}
                  </span>

                  <button
                    className="export-button"
                    onClick={exportReport}
                    type="button"
                  >
                    ↓ Export Excel
                  </button>
                </>
              )}
            </div>
          </div>


          <div className="stats-grid">
            <StatCard label="Total issues" value={summary?.totalIssues} icon="⌕" tone="purple" />
            <StatCard label="Console errors" value={summary?.consoleErrors} icon="!" tone="red" />
            <StatCard label="Failed requests" value={summary?.failedRequests} icon="↗" tone="orange" />
            <StatCard label="Missing images" value={summary?.missingImages} icon="▧" tone="blue" />
          </div>

          {result ? (
            <>
              <div className="scan-meta">
                <div>
                  <span className="meta-label">SCANNED WEBSITE</span>
                  <a href={result.url} target="_blank" rel="noreferrer">{result.url}</a>
                </div>
                <div>
                  <span className="meta-label">SCAN TIME</span>
                  <span>{new Date(result.scannedAt).toLocaleString()}</span>
                </div>
              </div>

              <div className="issues-panel">
                <div className="issues-heading">
                  <h3>Detected issues</h3>
                  <span>{result.issues?.length || 0} findings</span>
                </div>

                {result.issues?.length ? (
                  <div className="issue-list">
                    {result.issues.map((issue, index) => (
                      <article className="issue-item" key={`${issue.type}-${index}`}>
                        <span className="issue-symbol">
                          {issueIcon[issue.type] || "!"}
                        </span>
                        <div className="issue-content">
                          <strong>{issue.type}</strong>
                          <p>{issue.message}</p>
                          {issue.resourceUrl && (
                            <a href={issue.resourceUrl} target="_blank" rel="noreferrer">
                              {issue.resourceUrl}
                            </a>
                          )}
                        </div>
                        <span className={`severity ${issue.severity?.toLowerCase() || "low"}`}>
                          {issue.severity || "Unclassified"}
                        </span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <span className="success-check">✓</span>
                    <h4>No issues detected in this scan</h4>
                    <p>The scanner completed its current checks. This does not guarantee the site is bug-free.</p>
                  </div>
                )}
              </div>

              {result.screenshot && (
                <div className="screenshot-panel">
                  <div>
                    <h3>Screenshot evidence</h3>
                    <p>Full-page screenshot captured during the scan.</p>
                  </div>
                  <a
                    className="secondary-button"
                    href={`${API_URL}${result.screenshot}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View screenshot ↗
                  </a>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state initial-state">
              <span className="empty-icon">⌕</span>
              <h4>Ready when you are</h4>
              <p>Start your first scan to see detected issues and evidence here.</p>
            </div>
          )}
        </section>


        <section className="history-section">
          <div className="results-heading">
            <div>
              <p className="eyebrow">PAST ACTIVITY</p>
              <h3>Scan History</h3>
            </div>

            <button
              type="button"
              className="export-button"
              onClick={loadHistory}
              disabled={historyLoading}
            >
              {historyLoading ? "Refreshing..." : "↻ Refresh"}
            </button>
          </div>

          {historyError && (
            <div className="error-banner" role="alert">
              {historyError}
            </div>
          )}

          <div className="history-list">
            {scanHistory.map((scan) => (
              <button
                type="button"
                className="history-item"
                key={scan.id}
                onClick={() => openHistoryScan(scan.id)}
              >
                <span className="history-icon">◈</span>

                <span className="history-details">
                  <strong>{scan.url}</strong>
                  <span>
                    Scan #{scan.id} ·{" "}
                    {new Date(scan.scannedAt).toLocaleString()}
                  </span>
                </span>

                <span className="history-count">
                  {scan.totalIssues} issues
                </span>

                <span
                  className={`history-status ${scan.status === "completed" ? "completed" : "failed"
                    }`}
                >
                  {scan.status}
                </span>

                <span className="history-arrow">↗</span>
              </button>
            ))}

            {!historyLoading && scanHistory.length === 0 && !historyError && (
              <div className="empty-state">
                <h4>No scan history yet</h4>
                <p>Your completed scans will appear here.</p>
              </div>
            )}
          </div>
        </section>

        <section className="comparison-section">
          <div className="results-heading">
            <div>
              <p className="eyebrow">REGRESSION ANALYSIS</p>
              <h3>Compare Scans</h3>
            </div>

            <button
              type="button"
              className="export-button"
              onClick={compareLatestScans}
              disabled={comparing}
            >
              {comparing ? "Comparing..." : "⇄ Compare Latest Two"}
            </button>
          </div>

          <p className="comparison-description">
            Compare the two most recent saved scans to track changes in detected issues.
          </p>

          {compareError && (
            <div className="error-banner" role="alert">
              {compareError}
            </div>
          )}

          {comparison && (
            <>
              <div className="comparison-meta">
                <span>
                  Previous: #{comparison.previousScan.id}
                </span>
                <span>
                  Latest: #{comparison.latestScan.id}
                </span>
              </div>

              <div className="stats-grid comparison-stats">
                <StatCard
                  label="New issues"
                  value={comparison.newIssues.length}
                  icon="+"
                  tone="red"
                />

                <StatCard
                  label="Fixed findings"
                  value={comparison.fixedIssues.length}
                  icon="✓"
                  tone="blue"
                />

                <StatCard
                  label="Still present"
                  value={comparison.persistentIssues.length}
                  icon="↔"
                  tone="orange"
                />

                <StatCard
                  label="Previous issues"
                  value={comparison.previousScan.totalIssues}
                  icon="◷"
                  tone="purple"
                />
              </div>

              {[
                {
                  title: "New issues",
                  items: comparison.newIssues,
                  description: "Findings detected in the latest scan only.",
                  tone: "new",
                },
                {
                  title: "No longer detected",
                  items: comparison.fixedIssues,
                  description: "Previous findings absent from the latest scan.",
                  tone: "fixed",
                },
                {
                  title: "Still present",
                  items: comparison.persistentIssues,
                  description: "Findings detected in both scans.",
                  tone: "persistent",
                },
              ].map((group) => (
                <div className="comparison-group" key={group.title}>
                  <div className="comparison-group-heading">
                    <h4>{group.title}</h4>
                    <span>{group.items.length}</span>
                  </div>

                  <p className="comparison-description">
                    {group.description}
                  </p>

                  {group.items.length === 0 ? (
                    <p className="comparison-empty">No findings in this category.</p>
                  ) : (
                    <div className="comparison-issue-list">
                      {group.items.map((issue, index) => (
                        <article
                          className="comparison-issue"
                          key={`${group.tone}-${index}-${issue.type}`}
                        >
                          <div>
                            <strong>{issue.type}</strong>
                            <p>{issue.message}</p>
                            <span>{issue.resourceUrl || issue.url || ""}</span>
                          </div>

                          <span className={`severity ${(issue.severity || "low").toLowerCase()
                            }`}>
                            {issue.severity || "Unclassified"}
                          </span>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </section>


        <footer id="how-it-works">
          <span>BugLens AI · Automated QA</span>
          <span>Built with React & Playwright</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
