import test from "node:test";
import assert from "node:assert/strict";
import { handleRoute } from "../src/server.js";
import { generateReviewReport } from "../src/lib/review.js";

test("generateReviewReport flags major HTML launch issues", async () => {
  const report = await generateReviewReport({
    url: "https://example.com",
    html: `
      <!doctype html>
      <html>
        <head>
          <title>Short</title>
        </head>
        <body>
          <img src="/hero.png">
          <a href="/signup">Click here</a>
          <button>Learn more</button>
        </body>
      </html>
    `
  });

  assert.equal(report.summary.verdict, "blocked");
  assert.ok(report.findings.some((finding) => finding.id === "responsive-missing-viewport"));
  assert.ok(report.findings.some((finding) => finding.id === "a11y-missing-alt"));
  assert.ok(report.findings.some((finding) => finding.id === "copy-generic-cta"));
});

test("generateReviewReport handles screenshot-only input", async () => {
  const report = await generateReviewReport({
    screenshots: [
      {
        name: "desktop-home.png",
        mimeType: "image/png",
        width: 1440,
        height: 900,
        sizeBytes: 120000
      }
    ]
  });

  assert.equal(report.summary.verdict, "needs-work");
  assert.ok(report.findings.some((finding) => finding.id === "coverage-single-screenshot"));
  assert.ok(report.findings.some((finding) => finding.id === "coverage-missing-mobile-evidence"));
});

test("route handler returns a structured review response", async () => {
  const { statusCode, payload } = await handleRoute({
    method: "POST",
    url: "/api/review",
    body: {
      url: "https://example.com",
      html: `
        <!doctype html>
        <html lang="en">
          <head>
            <title>Launch QA Example Page Title</title>
            <meta name="description" content="Example description for tests.">
            <meta name="viewport" content="width=device-width, initial-scale=1">
          </head>
          <body>
            <h1>Example</h1>
            <button aria-label="Open menu"></button>
          </body>
        </html>
      `
    }
  });

  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.report.input.url, "https://example.com/");
  assert.ok(typeof payload.report.chatResponse === "string");
});

test("route handler rejects invalid requests", async () => {
  const { statusCode, payload } = await handleRoute({
    method: "POST",
    url: "/api/review",
    body: {}
  });

  assert.equal(statusCode, 400);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Provide at least one/);
});
