# Launch QA Plan

## Phase 1

- Define the exact input types: URL, screenshots, or both
- Define the report schema and severity model
- Decide which checks are deterministic versus model-driven
- Draft approval-safe product copy and privacy stance

## Phase 2

- Build a minimal backend that accepts a URL or screenshots
- Capture page metadata and render screenshots when needed
- Generate a structured report with prioritized findings
- Return results in a chat-friendly format

## Phase 3

- Add focused checks for accessibility, responsiveness, copy clarity, and SEO basics
- Improve issue grouping to reduce noisy duplicate findings
- Add report export options

## Phase 4

- Test reliability on a representative set of sites
- Tighten false positive rates
- Prepare app submission assets, policies, and review notes

## Open Questions

- Should the first release support staging URLs with auth, or only public pages?
- How much evidence should each finding include?
- Should the app score pages numerically, or keep output purely qualitative?
