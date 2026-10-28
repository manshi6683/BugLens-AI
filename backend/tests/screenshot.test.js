const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { getValidScreenshot } = require("../server");

const evidenceDir = path.join(
    __dirname,
    "..",
    "reports",
    "form-test-screenshots"
);

test("Accepts an existing PNG screenshot", () => {
    fs.mkdirSync(evidenceDir, { recursive: true });

    const filename = `screenshot-test-${process.pid}.png`;
    const screenshotPath = path.join(evidenceDir, filename);
    const screenshotUrl = `/reports/form-test-screenshots/${filename}`;

    try {
        fs.writeFileSync(screenshotPath, Buffer.from("test-image"));

        assert.equal(getValidScreenshot(screenshotUrl), screenshotUrl);
    } finally {
        if (fs.existsSync(screenshotPath)) {
            fs.unlinkSync(screenshotPath);
        }
    }
});

test("Rejects a missing screenshot", () => {
    assert.equal(
        getValidScreenshot(
            "/reports/form-test-screenshots/does-not-exist.png"
        ),
        null
    );
});

test("Rejects a path traversal attempt", () => {
    assert.equal(
        getValidScreenshot("/reports/form-test-screenshots/../secret.png"),
        null
    );
});

test("Rejects a non-PNG screenshot", () => {
    assert.equal(
        getValidScreenshot("/reports/form-test-screenshots/document.jpg"),
        null
    );
});

test("Rejects invalid screenshot values", () => {
    assert.equal(getValidScreenshot(null), null);
    assert.equal(getValidScreenshot(123), null);
});
