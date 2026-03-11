# Launch QA v1 Spec

## Goal

Ship a first usable review service that accepts a single public URL, screenshots, or both and returns a structured launch-readiness report. The first release stays read-only and avoids claims that require deeper browser automation or regulated compliance coverage.

## Release Decisions

### Supported inputs

- One public `http` or `https` URL
- Up to 10 screenshots with basic metadata
- URL-only, screenshot-only, or combined submissions
- Optional user context such as launch goal, audience, and release notes

### Deferred inputs

- Authenticated staging environments
- Multi-page crawl sessions
- Video recordings
- Direct browser automation during the review request

## Report Schema

```json
{
  "version": "0.1.0",
  "generatedAt": "ISO-8601 timestamp",
  "input": {
    "url": "string|null",
    "screenshotCount": 0,
    "hasInlineHtml": false,
    "context": {}
  },
  "summary": {
    "verdict": "blocked|needs-work|close-to-ready",
    "headline": "string",
    "counts": {
      "critical": 0,
      "high": 0,
      "medium": 0,
      "low": 0
    },
    "topPriorities": ["string"]
  },
  "findings": [
    {
      "id": "string",
      "category": "accessibility|responsiveness|copy|seo|coverage",
      "severity": "critical|high|medium|low",
      "title": "string",
      "summary": "string",
      "recommendation": "string",
      "evidence": ["string"],
      "source": "deterministic"
    }
  ],
  "coverage": {
    "deterministicChecks": ["string"],
    "modelDrivenChecksPlanned": ["string"],
    "limitations": ["string"]
  },
  "chatResponse": "markdown string"
}
```

## Severity Model

- `critical`: likely blocks launch or creates a major trust, access, or legal risk
- `high`: strong launch risk that should be fixed before release
- `medium`: meaningful quality issue that weakens readiness but may not block launch
- `low`: polish gap, missing evidence, or improvement opportunity

The v1 backend remains qualitative. It does not assign a single numeric score because that would imply precision the checks do not support yet.

## Deterministic Checks in v1

- Missing or weak page metadata: title, description, canonical, Open Graph basics
- Missing viewport meta for mobile rendering
- Missing `lang` on `<html>`
- Images missing `alt` attributes
- Missing or repeated `h1`
- Generic or empty CTA labels in links and buttons
- Screenshot evidence coverage: missing dimensions, no mobile-sized evidence, or only one screenshot

## Model-Driven Checks Deferred to Later Phases

- Flow-level UX review across multiple steps
- Copy quality beyond deterministic heuristics
- Visual hierarchy and layout critique from pixels
- OCR over screenshots
- Duplicate issue clustering across related screens

## Privacy and Product Copy

### Product copy

Launch QA reviews what a team is about to ship and returns prioritized, actionable findings across accessibility, responsiveness, copy clarity, and SEO basics. The output is a launch-readiness report, not a certification.

### Privacy stance

- Process only the submitted URL, HTML, and screenshots
- Keep the first release read-only
- Avoid collecting credentials in v1
- Treat screenshots and fetched content as review inputs, not training material
- Be explicit when coverage is incomplete because the review lacked auth access, mobile evidence, or multi-step flow data
