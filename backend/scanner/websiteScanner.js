
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

async function scanWebsite(targetUrl) {
  let browser;

  const results = {
    url: targetUrl,
    scannedAt: new Date().toISOString(),
    status: "completed",
    summary: {
      totalIssues: 0,
      brokenLinks: 0,
      consoleErrors: 0,
      failedRequests: 0,
      missingImages: 0,
    },
    issues: [],
    screenshot: null,
  };

  try {
    const parsedUrl = new URL(targetUrl);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs are supported.");
    }

    browser = await chromium.launch({ headless: true });

    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });

    // 1. Detect JavaScript runtime errors.
    page.on("pageerror", (error) => {
      results.issues.push({
        type: "JavaScript Error",
        severity: "High",
        message: error.message,
        url: page.url(),
      });
    });

    // 2. Detect browser console errors.
    page.on("console", (message) => {
      if (message.type() === "error") {
        results.issues.push({
          type: "Console Error",
          severity: "Medium",
          message: message.text(),
          url: page.url(),
        });
      }
    });

    // 3. Detect failed network requests.
    page.on("requestfailed", (request) => {
      results.issues.push({
        type: "Failed Request",
        severity: "Medium",
        message:
          request.failure()?.errorText || "Request failed",
        resourceUrl: request.url(),
        url: page.url(),
      });
    });

    // 4. Open the website.
    const response = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (response && response.status() >= 400) {
      results.issues.push({
        type: "HTTP Error",
        severity: "High",
        message: `Page returned HTTP ${response.status()}`,
        url: targetUrl,
      });
    }

    await page.waitForTimeout(1500);

    // 5. Capture a full-page screenshot.
    const screenshotName = `scan-${Date.now()}.png`;

    const screenshotPath = path.join(
      __dirname,
      "..",
      "reports",
      screenshotName
    );

    fs.mkdirSync(path.dirname(screenshotPath), {
      recursive: true,
    });

    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    results.screenshot = `/reports/${screenshotName}`;

    // 6. Collect unique HTTP/HTTPS links.
    const links = await page.locator("a[href]").evaluateAll(
      (anchors) =>
        anchors.map((anchor) => ({
          text: anchor.innerText.trim() || "(no link text)",
          href: anchor.href,
        }))
    );

    const uniqueLinks = [
      ...new Map(
        links.map((link) => [link.href, link])
      ).values(),
    ];

    let brokenLinkCount = 0;

    // Check up to 30 unique links per scan.
    for (const link of uniqueLinks.slice(0, 30)) {
      let linkUrl;

      try {
        linkUrl = new URL(link.href);
      } catch {
        continue;
      }

      if (!["http:", "https:"].includes(linkUrl.protocol)) {
        continue;
      }

      // Skip links pointing back to the scanned page.
      if (link.href === targetUrl) {
        continue;
      }

      try {
        const linkResponse = await page.request.get(link.href, {
          timeout: 8000,
          maxRedirects: 5,
        });

        const statusCode = linkResponse.status();

        if (statusCode >= 400) {
          brokenLinkCount++;

          results.issues.push({
            type: "Broken Link",
            severity: statusCode >= 500 ? "High" : "Medium",
            message: `Link returned HTTP ${statusCode}: ${link.text}`,
            resourceUrl: link.href,
            httpStatus: statusCode,
            url: targetUrl,
          });
        }
      } catch (error) {
        results.issues.push({
          type: "Link Check Failed",
          severity: "Low",
          message: `Could not verify link: ${link.text}. ${
            error.message
          }`,
          resourceUrl: link.href,
          url: targetUrl,
        });
      }
    }

    // 7. Detect images that failed to load.
    const missingImages = await page.locator("img").evaluateAll(
      (images) =>
        images
          .filter(
            (image) =>
              !image.complete || image.naturalWidth === 0
          )
          .map((image) => ({
            src: image.src,
            alt: image.alt || "(missing alt text)",
          }))
    );

    for (const image of missingImages) {
      results.issues.push({
        type: "Missing Image",
        severity: "Medium",
        message: `Image failed to load: ${image.src}`,
        resourceUrl: image.src,
        url: targetUrl,
      });
    }

    // 8. Calculate final summary.
    results.summary.brokenLinks = brokenLinkCount;
    results.summary.missingImages = missingImages.length;

    results.summary.consoleErrors = results.issues.filter(
      (issue) =>
        issue.type === "Console Error" ||
        issue.type === "JavaScript Error"
    ).length;

    results.summary.failedRequests = results.issues.filter(
      (issue) => issue.type === "Failed Request"
    ).length;

    results.summary.totalIssues = results.issues.length;
  } catch (error) {
    results.status = "failed";
    results.error = error.message;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return results;
}

module.exports = { scanWebsite };
