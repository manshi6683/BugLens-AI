const crypto = require("crypto");
const { testForms } = require("./scanner/formTester");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { scanWebsite } = require("./scanner/websiteScanner");
const DB_PATH = process.env.BUGLENS_DB_PATH ||
    path.join(__dirname, "buglens.db");

const db = new Database(DB_PATH); const app = express();
const PORT = Number(process.env.PORT) || 5000;
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS scan_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    scanned_at TEXT NOT NULL,
    status TEXT NOT NULL,
    total_issues INTEGER NOT NULL DEFAULT 0,
    result_json TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS bug_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT NOT NULL UNIQUE,
    test_name TEXT NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'FAIL',
    screenshot TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
const bugReportColumns = db
    .prepare("PRAGMA table_info(bug_reports)")
    .all()
    .map((column) => column.name);

if (!bugReportColumns.includes("resolved_at")) {
    db.exec(`
    ALTER TABLE bug_reports
    ADD COLUMN resolved_at TEXT
  `);
}

if (!bugReportColumns.includes("severity")) {
    db.exec(`
        ALTER TABLE bug_reports
        ADD COLUMN severity TEXT NOT NULL DEFAULT 'Medium'
    `);
}

if (!bugReportColumns.includes("priority")) {
    db.exec(`
        ALTER TABLE bug_reports
        ADD COLUMN priority TEXT NOT NULL DEFAULT 'P3'
    `);
}


const saveScan = db.prepare(`
  INSERT INTO scan_history (
    url,
    scanned_at,
    status,
    total_issues,
    result_json
  )
  VALUES (?, ?, ?, ?, ?)
`);

const getScans = db.prepare(`
  SELECT id, url, scanned_at, status, total_issues
  FROM scan_history
  ORDER BY id DESC
  LIMIT ?
`);

const getScanById = db.prepare(`
  SELECT id, result_json
  FROM scan_history
  WHERE id = ?
`);

app.use(cors());
app.use(express.json({ limit: "10kb" }));

app.use(
    "/reports",
    express.static(path.join(__dirname, "reports"))
);

app.get("/", (req, res) => {
    res.json({
        message: "Welcome to BugLens AI API!",
        status: "Running",
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "BugLens AI backend is healthy",
    });
});

// Get recent scan history.
app.get("/api/scans", (req, res) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 100)
        : 20;

    const scans = getScans.all(limit).map((scan) => ({
        id: scan.id,
        url: scan.url,
        scannedAt: scan.scanned_at,
        status: scan.status,
        totalIssues: scan.total_issues,
    }));

    res.json({
        success: true,
        count: scans.length,
        scans,
    });
});

// Get a specific saved scan.
app.get("/api/scans/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid scan ID.",
        });
    }

    const scan = getScanById.get(id);

    if (!scan) {
        return res.status(404).json({
            success: false,
            message: "Scan not found.",
        });
    }

    return res.json({
        success: true,
        id: scan.id,
        result: JSON.parse(scan.result_json),
    });
});

// Run a new scan and save its result.
app.post("/api/scan", async (req, res) => {
    const { url } = req.body;

    if (!url || typeof url !== "string") {
        return res.status(400).json({
            success: false,
            message: "Please provide a website URL.",
        });
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(url.trim());
    } catch {
        return res.status(400).json({
            success: false,
            message: "Please provide a valid website URL.",
        });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return res.status(400).json({
            success: false,
            message: "Only HTTP and HTTPS URLs are allowed.",
        });
    }

    try {
        const result = await scanWebsite(parsedUrl.href);

        const insert = saveScan.run(
            result.url,
            result.scannedAt,
            result.status,
            result.summary.totalIssues,
            JSON.stringify(result)
        );

        result.id = Number(insert.lastInsertRowid);

        return res.status(
            result.status === "completed" ? 200 : 422
        ).json({
            success: result.status === "completed",
            result,
        });
    } catch (error) {
        console.error("Scan error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not save or complete the scan.",
        });
    }
});

app.post("/api/form-tests", async (req, res) => {
    const { url } = req.body;

    if (!url || typeof url !== "string") {
        return res.status(400).json({
            success: false,
            message: "Please provide a website URL.",
        });
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(url.trim());
    } catch {
        return res.status(400).json({
            success: false,
            message: "Please provide a valid website URL.",
        });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return res.status(400).json({
            success: false,
            message: "Only HTTP and HTTPS URLs are supported.",
        });
    }

    try {
        const result = await testForms(parsedUrl.href);

        const bugReportSync = {
            reportsOpened: 0,
            reportsResolved: 0,
            skipped: 0,
        };

        if (result.status === "completed" && Array.isArray(result.tests)) {
            const saveBug = db.prepare(`
                INSERT INTO bug_reports (
                    report_id, test_name, message, status,
                    screenshot, resolved_at, severity, priority
                )
                VALUES (?, ?, ?, 'OPEN', ?, NULL, ?, ?)
                ON CONFLICT(report_id) DO UPDATE SET
                    test_name = excluded.test_name,
                    message = excluded.message,
                    status = 'OPEN',
                    screenshot = COALESCE(excluded.screenshot, bug_reports.screenshot),
                    resolved_at = NULL,
                    severity = excluded.severity,
                    priority = excluded.priority
            `);

            const resolveBug = db.prepare(`
                UPDATE bug_reports
                SET status = 'RESOLVED',
                    resolved_at = CURRENT_TIMESTAMP,
                    message = ?
                WHERE report_id = ?
                  AND test_name = ?
                  AND status IN ('OPEN', 'FAIL')
            `);

            const syncReports = db.transaction(() => {
                for (const test of result.tests) {
                    if (!test.name || !["PASS", "FAIL"].includes(test.status)) {
                        bugReportSync.skipped++;
                        continue;
                    }

                    const reportId = "FORM-" + crypto
                        .createHash("sha256")
                        .update(`${parsedUrl.href}::${test.name}`)
                        .digest("hex")
                        .slice(0, 20);

                    if (test.status === "FAIL") {
                        const classification = classifyBug(
                            test.name,
                            test.message || ""
                        );

                        saveBug.run(
                            reportId,
                            test.name,
                            test.message || "Automated form test failed.",
                            getValidScreenshot(test.screenshot),
                            classification.severity,
                            classification.priority
                        );

                        bugReportSync.reportsOpened++;
                    } else {
                        const update = resolveBug.run(
                            test.message || "Test passed on the latest run.",
                            reportId,
                            test.name
                        );

                        if (update.changes > 0) {
                            bugReportSync.reportsResolved++;
                        }
                    }
                }
            });

            syncReports();
        }

        return res.status(result.status === "completed" ? 200 : 422).json({
            success: result.status === "completed",
            result,
            bugReportSync,
        });
    } catch (error) {
        console.error("Form testing or bug-report synchronization failed:", error);

        return res.status(500).json({
            success: false,
            message: "Form testing or bug-report synchronization failed.",
        });
    }
});

// Get saved bug reports

app.get("/api/bug-reports", (req, res) => {
    try {
        const reports = db
            .prepare("SELECT * FROM bug_reports ORDER BY id DESC")
            .all();

        return res.json({
            success: true,
            reports,
        });
    } catch (error) {
        console.error("Failed to fetch bug reports:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to fetch bug reports",
        });
    }
});
function getValidScreenshot(screenshot) {
    if (typeof screenshot !== "string") {
        return null;
    }

    const prefix = "/reports/form-test-screenshots/";

    if (!screenshot.startsWith(prefix)) {
        return null;
    }

    const filename = screenshot.slice(prefix.length);

    if (!filename || path.basename(filename) !== filename) {
        return null;
    }

    if (!filename.toLowerCase().endsWith(".png")) {
        return null;
    }

    const screenshotPath = path.join(
        __dirname,
        "reports",
        "form-test-screenshots",
        filename
    );

    return fs.existsSync(screenshotPath) ? screenshot : null;
}

function classifyBug(testName = "", message = "") {
    const text = `${testName} ${message}`.toLowerCase();

    if (/security breach|data exposure|application crash|site unavailable/.test(text)) {
        return { severity: "Critical", priority: "P1" };
    }

    if (/core functionality|cannot login|payment failure|submission failed/.test(text)) {
        return { severity: "High", priority: "P2" };
    }

    if (/validation|invalid email|required field|password/.test(text)) {
        return { severity: "Medium", priority: "P3" };
    }

    return { severity: "Low", priority: "P4" };
}

app.post("/api/bug-reports", (req, res) => {
    try {
        const {
            reportId,
            testName,
            message,
            screenshot,
            status
        } = req.body;

        if (!reportId || !testName) {
            return res.status(400).json({
                success: false,
                message: "reportId and testName are required"
            });
        }

        if (!["OPEN", "RESOLVED"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Status must be OPEN or RESOLVED"
            });
        }

        const classification = classifyBug(testName, message);

        const saveReport = db.prepare(`
            INSERT INTO bug_reports (
                report_id,
                test_name,
                message,
                status,
                screenshot,
                resolved_at,
                severity,
                priority
            )
            VALUES (
                ?, ?, ?, ?, ?,
                CASE WHEN ? = 'RESOLVED'
                    THEN CURRENT_TIMESTAMP ELSE NULL END,
                ?, ?
            )
            ON CONFLICT(report_id) DO UPDATE SET
                test_name = excluded.test_name,
                message = excluded.message,
                status = excluded.status,
                screenshot = COALESCE(
                    excluded.screenshot,
                    bug_reports.screenshot
                ),
                resolved_at = CASE
                    WHEN excluded.status = 'RESOLVED'
                    THEN CURRENT_TIMESTAMP
                    ELSE NULL
                END,
                severity = excluded.severity,
                priority = excluded.priority
        `);

        saveReport.run(
            String(reportId),
            String(testName),
            message ? String(message) : "",
            status,
            getValidScreenshot(screenshot),
            status,
            classification.severity,
            classification.priority
        );

        return res.json({
            success: true,
            message: `Bug report marked ${status}`,
            severity: classification.severity,
            priority: classification.priority
        });
    } catch (error) {
        console.error("Failed to save bug report:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to save bug report"
        });
    }
});


app.post("/api/bug-reports/resolve", (req, res) => {
    try {
        const { reportId, testName, message } = req.body;

        if (!reportId || !testName) {
            return res.status(400).json({
                success: false,
                message: "reportId and testName are required",
            });
        }

        const update = db.prepare(`
      UPDATE bug_reports
      SET
        status = 'RESOLVED',
        resolved_at = CURRENT_TIMESTAMP,
        message = ?
      WHERE report_id = ?
        AND test_name = ?
        AND status IN ('OPEN', 'FAIL')
    `);

        const result = update.run(
            message || "Test passed on the latest run.",
            String(reportId),
            String(testName)
        );

        return res.json({
            success: true,
            resolved: result.changes > 0,
            message: result.changes > 0
                ? "Existing bug report resolved."
                : "No open bug report needed resolving.",
        });
    } catch (error) {
        console.error("Failed to resolve bug report:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to resolve bug report",
        });
    }
});

let server;

function startServer() {
    server = app.listen(PORT, () => {
        console.log(`BugLens AI API running at http://localhost:${PORT}`);
        console.log(`SQLite database: ${DB_PATH}`);
    });

    return server;
}

function shutdown() {
    if (server) {
        server.close(() => {
            if (db.open) {
                db.close();
            }
            process.exit(0);
        });
    } else {
        if (db.open) {
            db.close();
        }
        process.exit(0);
    }
}

if (require.main === module) {
    startServer();
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

module.exports = { app, db, startServer, getValidScreenshot };