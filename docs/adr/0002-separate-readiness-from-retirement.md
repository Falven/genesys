---
status: accepted
---

# Separate Worker readiness from retirement

Genesys builds and starts a replacement before it requests shutdown of the previous Worker.
Readiness alone cannot authorize retirement because pinned executions can still require the previous version.
Genesys retains that Worker and its corresponding build until native Temporal rules permit removal, even after the replacement becomes ready.
