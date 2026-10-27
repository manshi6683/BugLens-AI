const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function testForms(targetUrl) {
  let browser;

  const result = {
    url: targetUrl,
    testedAt: new Date().toISOString(),
    status: "completed",
    summary: {
      formsFound: 0,
      checksPassed: 0,
      checksFailed: 0,
      checksInfo: 0,
    },
    tests: [],
  };

  const evidenceDir = path.join(
    __dirname,
    "..",
    "reports",
    "form-test-screenshots"
  );

  fs.mkdirSync(evidenceDir, { recursive: true });

  async function record(
    page,
    name,
    passed,
    passMessage,
    failMessage,
    details = {}
  ) {
    const test = {
      name,
      status: passed ? "PASS" : "FAIL",
      message: passed ? passMessage : failMessage,
      details,
    };

    if (!passed && page) {
      const safeName = name
        .replace(/[^a-z0-9-_]/gi, "_")
        .slice(0, 80);

      const screenshotName =
        `${Date.now()}-${safeName}.png`;

      const screenshotPath = path.join(
        evidenceDir,
        screenshotName
      );

      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
        });

        test.screenshot =
          `/reports/form-test-screenshots/${screenshotName}`;
      } catch (error) {
        test.screenshotError = error.message;
      }
    }

    result.tests.push(test);
  }

  try {
    const parsed = new URL(targetUrl);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs are supported.");
    }

    browser = await chromium.launch({ headless: true });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Block ordinary HTML form POST navigation.
    await page.route("**/*", async (route) => {
      const request = route.request();

      if (
        request.isNavigationRequest() &&
        request.method() === "POST"
      ) {
        await route.abort();
        return;
      }

      await route.continue();
    });

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const forms = page.locator("form");
    result.summary.formsFound = await forms.count();

    if (result.summary.formsFound === 0) {
      result.tests.push({
        name: "Form discovery",
        status: "INFO",
        message: "No HTML forms were found on this page.",
      });
    }

    for (let i = 0; i < result.summary.formsFound; i++) {
      const form = forms.nth(i);
      const formId = await form.getAttribute("id");
      const formName = formId || `Form ${i + 1}`;

      const submitButton = form.locator(
        'button[type="submit"], input[type="submit"], button:not([type])'
      ).first();

      const hasSubmitButton = await submitButton.count();

      const submitEnabled =
        hasSubmitButton > 0 &&
        await submitButton.isEnabled();

      // Test 1: Empty required fields.
      const requiredFields = form.locator(
        'input[required], select[required], textarea[required]'
      );

      const requiredCount = await requiredFields.count();

      if (requiredCount > 0) {
        const originalValues = [];

        for (let j = 0; j < requiredCount; j++) {
          const field = requiredFields.nth(j);

          originalValues.push({
            value: await field.inputValue().catch(() => ""),
            checked: await field.isChecked().catch(() => false),
            tag: await field.evaluate(el => el.tagName.toLowerCase()),
            type: await field.getAttribute("type"),
          });

          const type = (await field.getAttribute("type") || "").toLowerCase();

          if (type === "checkbox" || type === "radio") {
            if (await field.isChecked().catch(() => false)) {
              await field.uncheck().catch(() => { });
            }
          } else if (type !== "hidden" && type !== "file") {
            await field.fill("").catch(() => { });
          }
        }

        const emptyFormValid = await form.evaluate(
          element => element.checkValidity()
        );

        await record(
          page,
          `${formName}: Empty required fields`,
          !emptyFormValid,
          "Browser correctly rejected the empty form.",
          "The form passed native validation despite empty required fields.",
          { requiredFields: requiredCount }
        );

        // Restore original values.
        for (let j = 0; j < requiredCount; j++) {
          const field = requiredFields.nth(j);
          const original = originalValues[j];
          const type = (original.type || "").toLowerCase();

          if (type === "checkbox" || type === "radio") {
            if (original.checked) {
              await field.check().catch(() => { });
            }
          } else if (type !== "hidden" && type !== "file") {
            await field.fill(original.value).catch(() => { });
          }
        }
      } else {
        result.tests.push({
          name: `${formName}: Empty required fields`,
          status: "INFO",
          message: "No required fields were declared.",
        });
      }


      // Test 2: Invalid email.
      const emailFields = form.locator(
        'input[type="email"], input[name="email"], input[id="email"]'
      );
      const emailCount = await emailFields.count();

      if (emailCount > 0) {
        const emailField = emailFields.first();
        const originalValue = await emailField.inputValue();
        const inputType = (
          await emailField.getAttribute("type") || "text"
        ).toLowerCase();

        await emailField.fill("invalid-email");

        const invalidEmailAccepted = await emailField.evaluate(
          (element) => element.checkValidity()
        );

        const nativeEmailValidationSupported = inputType === "email";

        await record(
          page,
          `${formName}: Invalid email`,
          nativeEmailValidationSupported && !invalidEmailAccepted,
          "Browser rejected the invalid email.",
          !nativeEmailValidationSupported
            ? "Email field is not configured with type=email, so native email validation is missing."
            : "The invalid email passed browser validation.",
          {
            inputType,
            invalidEmailAccepted
          }
        );

        await emailField.fill(originalValue);
      } else {
        await record(
          page,
          `${formName}: Invalid email`,
          false,
          "",
          "Email field was not found; invalid-email validation could not be tested."
        );
      }


      // Test 3: Short password.
      const passwordFields = form.locator('input[type="password"]');
      const passwordCount = await passwordFields.count();

      if (passwordCount > 0) {
        const passwordField = passwordFields.first();

        const minLength = Number(
          await passwordField.getAttribute("minlength") || 0
        );

        if (minLength > 1) {
          const originalValue = await passwordField.inputValue();

          await passwordField.fill("a");

          const shortPasswordAccepted =
            await passwordField.evaluate(
              (element) => element.checkValidity()
            );

          await record(
            page,
            `${formName}: Short password`,
            !shortPasswordAccepted,
            `Browser rejected a password shorter than ${minLength} characters.`,
            "A short password passed browser validation.",
            { minimumLength: minLength }
          );

          await passwordField.fill(originalValue);
        } else {
          result.tests.push({
            name: `${formName}: Short password`,
            status: "INFO",
            message: "No password minlength greater than 1 was configured.",
          });
        }
      }

      // Test 4: Prepare synthetic values for valid frontend submission.
      if (!hasSubmitButton || !submitEnabled) {
        result.tests.push({
          name: `${formName}: Valid submission`,
          status: "INFO",
          message: "No enabled submit button was found.",
        });

        continue;
      }

      const fields = form.locator(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea'
      );

      const fieldCount = await fields.count();

      for (let j = 0; j < fieldCount; j++) {
        const field = fields.nth(j);

        if (!(await field.isVisible().catch(() => false))) {
          continue;
        }

        const type = (
          await field.getAttribute("type") || "text"
        ).toLowerCase();

        const disabled = await field.isDisabled().catch(() => true);

        if (disabled) continue;

        if (type === "checkbox" || type === "radio") {
          const required =
            await field.getAttribute("required") !== null;

          if (required && !(await field.isChecked())) {
            await field.check().catch(() => { });
          }

          continue;
        }

        if (type === "email") {
          await field.fill("qa.tester@example.com");
          continue;
        }

        if (type === "password") {
          const minLength = Number(
            await field.getAttribute("minlength") || 0
          );

          await field.fill(
            "QaTestPassword123".padEnd(minLength, "x")
          );

          continue;
        }

        if (type === "number") {
          await field.fill("25");
          continue;
        }

        if (type === "date") {
          await field.fill("2000-01-15");
          continue;
        }

        if (type === "file") {
          result.tests.push({
            name: `${formName}: File input`,
            status: "INFO",
            message: "File upload was skipped because no test file was provided.",
          });

          continue;
        }

        const tagName = await field.evaluate(
          (element) => element.tagName.toLowerCase()
        );

        if (tagName === "select") {
          const options = await field.locator("option").evaluateAll(
            (items) => items.map((option) => ({
              value: option.value,
              disabled: option.disabled,
            }))
          );

          const usableOption = options.find(
            (option) => option.value && !option.disabled
          );

          if (usableOption) {
            await field.selectOption(usableOption.value).catch(() => { });
          }

          continue;
        }

        const name = (
          await field.getAttribute("name") ||
          await field.getAttribute("id") ||
          await field.getAttribute("placeholder") ||
          ""
        ).toLowerCase();

        if (type === "tel") {
          await field.fill("9876543210");
        } else if (name.includes("name")) {
          await field.fill("QA Test User");
        } else if (name.includes("subject")) {
          await field.fill("Automated QA test");
        } else if (name.includes("message")) {
          await field.fill("This is an automated form testing message.");
        } else if (type === "url") {
          await field.fill("https://example.com");
        } else {
          await field.fill("QA test input");
        }
      }

      const validBeforeSubmit = await form.evaluate(
        (element) => element.checkValidity()
      );

      if (!validBeforeSubmit) {
        result.tests.push({
          name: `${formName}: Valid submission`,
          status: "INFO",
          message:
            "Could not create valid synthetic values for every field; submission was skipped.",
        });

        continue;
      }

      const messageSelector =
        formId === "registration-form"
          ? "#registration-message"
          : formId === "contact-form"
            ? "#contact-message"
            : null;

      const bodyBefore = await page.locator("body").innerText();

      await submitButton.click();
      await page.waitForTimeout(150);

      const messageText = messageSelector
        ? await page.locator(messageSelector).innerText().catch(() => "")
        : "";

      const bodyAfter = await page.locator("body").innerText();

      const changedBody = bodyAfter !== bodyBefore;

      const successMessage =
        /successfully|submitted|thank you|message sent|received/i.test(
          messageText || (changedBody ? bodyAfter : "")
        );

      await record(
        page,
        `${formName}: Valid submission`,
        successMessage,
        "A success message appeared after submitting the form.",
        "No recognizable success message appeared after submission.",
        {
          formId: formId || "",
          message: messageText || "",
          note:
            "This verifies frontend behavior only; it does not prove server-side storage.",
        }
      );
    }

    result.summary.checksPassed = result.tests.filter(
      (test) => test.status === "PASS"
    ).length;

    result.summary.checksFailed = result.tests.filter(
      (test) => test.status === "FAIL"
    ).length;

    result.summary.checksInfo = result.tests.filter(
      (test) => test.status === "INFO"
    ).length;
  } catch (error) {
    result.status = "failed";
    result.error = error.message;
  } finally {
    if (browser) await browser.close();
  }

  return result;
}

module.exports = { testForms };