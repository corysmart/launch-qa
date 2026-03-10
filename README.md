# Launch QA

`Launch QA` is a ChatGPT app concept for pre-launch website and app review.

The product audits a public URL, staging URL, or uploaded screenshots and returns a structured readiness report covering:

- accessibility issues
- mobile and responsive problems
- broken or confusing user flows
- weak copy or unclear calls to action
- basic SEO and metadata issues
- prioritized next steps before launch

## Why This Exists

Current ChatGPT apps already cover content creation, file search, meetings, and app building. `Launch QA` is positioned as a read-only quality layer that helps teams review what they are about to ship.

## Initial Scope

- Analyze one site or flow at a time
- Produce a concise report with severity levels
- Focus on actionable findings rather than generic advice
- Keep the first version read-only

## Non-Goals

- No code generation in v1
- No ticket creation in v1
- No automated browser testing farm in v1
- No regulated compliance claims

## Potential Users

- startup founders
- product managers
- designers
- marketers
- agencies

## Long-Term Direction

Later versions can add optional exports to GitHub, Jira, Linear, or Slack after the core review flow is stable.
