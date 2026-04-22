# Autopsy → api-gateway upload — dissertation evidence (Phase 7)

Artifacts for the thesis **§5.4 end-to-end latency** and **Autopsy-side upload integration**.

| Path | Purpose |
|------|---------|
| [mapping.md](mapping.md) | Thesis claims → files, log fields, and screenshots |
| [proposal-flow/](proposal-flow/) | **P4:** police **propose** from Autopsy → judge approve → auto-execute + CRUD (`README.md`, `mapping.md`, samples, screens) |
| [samples/](samples/) | Illustrative `upload_receipt.json` (redact before publishing if needed) |
| [screens/](screens/) | Screenshots (Monitor **Upload Status**, gateway logs); add your captures |
| [S6.3-fault-injection-checklist.md](S6.3-fault-injection-checklist.md) | Optional fault-injection steps (S6.3); skip if not run |

**Deploy path (Autopsy 4.22):** core JAR patch — `build-patch-core.bat` → `install-patch-core.bat` (see repo root `README.md`).

**Cross-reference:** sibling Cursor plan *Autopsy Upload Integration* (`autopsy_upload_integration_plan_0fc32560.plan.md`) — see [cross-plan-note.md](cross-plan-note.md) for linking the legacy “Case Data Extract” plugin plan.
