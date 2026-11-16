# 17: Run the same builds through Compose and local processes

**What to build:** Documented Compose and direct process startup consume the same versioned native Worker builds.

**Blocked by:** 10: Publish complete versioned builds.

**Status:** ready-for-agent

**State:** resolved

- [x] Provide runnable native startup and Compose examples with generated registration packaged with Worker code.
- [x] Keep connection addresses and other SDK options in native application or deployment settings.
- [x] Document container, local, and hybrid usage without adding a gsys dev service-selection mode.
- [x] Do not introduce required run scripts, another Worker configuration format, or production deployment orchestration.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.

## Comments

- Added `examples/native-workers`: native Go Workflow, Activity, and Worker; pinned Go SDK v1.51.0 module dependencies; Dockerfile using the repository CLI to generate and build; standard Compose deployment. The runtime image includes the entire versioned build and starts its native executable directly. Generated links preserve its original working directory and executable paths. Connection environment variables feed ordinary SDK options; the Task Queue stays in native Worker code.
- Added `docs/deployment.md` with direct startup from one selected immutable manifest, Compose startup, a containerized server with a host Worker, and exact Linux build reuse through a read-only mount at the original path. Platform-specific rebuilds, nonrelocatable Python environments, retention, native shutdown, and development-only image defaults are explicit.
- Verification on 2026-11-16: CLI TypeScript build; generated native Go build on macOS arm64 (Go 1.27.4); complete Docker image build on Linux arm64 using Go 1.26 and Node.js 24; `docker compose config`; `gofmt`; `oxfmt`; diff whitespace review. Inspected image configuration and copied files from a stopped container: native executable, generated aggregate/package registration, and both immutable launch targets were present. Removed the stopped inspection container.
- No tests, assertions, services, Workers, or Workflow executions ran. Initial analysis reports the not-yet-generated Go import; generation and native compilation succeed. Live connection, polling, shutdown timing, Linux bind-mount execution, Windows startup, and other architectures were not runtime-verified. No images or packages were published.

Final review follow-up: private build versions remain mode 0700. Docker copies
artifacts as its runtime UID:GID 65532:65532; exact local Linux bind-mount commands
use the host build owner's UID:GID. Added docs/GLOSSARY build inputs required by
the packaged CLI. Compose configuration and image rebuild passed; no container
runtime or Worker session ran. See [review evidence](../review.md).
