# 14: Replace Workers after source changes

**What to build:** Source changes build and start replacement Workers while existing Workers and Temporal remain active.

**Blocked by:** 11: Run a managed development session.

**Status:** ready-for-agent

**State:** open

- [ ] Watch source and relevant package inputs without rebuild loops from generated output.
- [ ] Build and start the candidate before retiring its predecessor. Require native readiness evidence.
- [ ] Keep the current Worker on build or startup failure. Report errors and keep watching.
- [ ] Keep Temporal running and preserve each Worker’s matching build.
- [ ] Unknown retirement eligibility retains the previous version. Do not claim replay compatibility or alter native task routing.
- [ ] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.
