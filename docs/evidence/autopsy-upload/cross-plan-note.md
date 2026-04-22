# Cross-plan note (S7.2)

The legacy **Case Data Extract** plugin plan (`autopsy_案件数据提取插件_04fd5518.plan.md`) may live only under the Cursor user plans directory, not in this git repo.

**Manual step:** open that plan and add an end section **“v2 · Blockchain Upload”** pointing to:

- This repository, and
- **`docs/evidence/autopsy-upload/`** (this folder)

**Deployment wording:** the authoritative install path for Autopsy **4.22.x** in this project is the **core JAR patch** (`build-patch-core.bat` / `install-patch-core.bat`), not standard NBM installation — see `.cursor/rules/autopsy-core-patch-deployment.mdc`.
