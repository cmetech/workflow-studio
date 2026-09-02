# Installing Workflow Studio

Workflow Studio v1.0.6 is the latest published release and the content-aware workbench release published on 2026-08-31. The v1.0.7 documentation-and-shortcuts release candidate is unpublished; no v1.0.7 tag or GitHub release exists as of 2026-09-02. Native installers are distributed through the public `cmetech/workflow-studio` GitHub Releases page. The application does not have an Apple Developer ID signature, Apple notarization, or a Microsoft Authenticode signature. Gatekeeper or SmartScreen warnings are expected. The release workflow produces `SHA256SUMS`, and the in-app updater uses a separate first-party cryptographic signature to prevent modified update artifacts from installing.

## Supported targets

| Operating system | Architecture | Artifact |
|---|---|---|
| macOS | Apple Silicon | `LOOP24-Workflow-Studio_<version>_macos_aarch64.dmg` |
| macOS | Intel | `LOOP24-Workflow-Studio_<version>_macos_x86_64.dmg` |
| Windows | x64 | `LOOP24-Workflow-Studio_<version>_windows_x86_64-setup.exe` |

Windows ARM64 is unsupported and is not silently redirected to x64. Linux is deferred and unsupported by the bootstrap; it has no AppImage, package, updater entry, or installation path in either the published v1.0.6 release or the v1.0.7 candidate.

## One-line verified installer launch

These commands load the immutable v1.0.5 bootstrap scripts, which install the latest published release. The bootstrap tag identifies the reviewed script bytes, not the application version it downloads. They currently install published v1.0.6; the unpublished v1.0.7 candidate is not selected unless it is later published. Review [the shell script](../scripts/install.sh) or [the PowerShell script](../scripts/install.ps1) first if that is your policy.

macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.5/scripts/install.sh | sh
```

Windows PowerShell:

```powershell
iex (irm 'https://raw.githubusercontent.com/cmetech/workflow-studio/v1.0.5/scripts/install.ps1')
```

Both commands use immutable v1.0.5 bootstrap URLs, then query GitHub for the latest published release and use that release's tag for every downloaded file. On macOS, the script selects the correct CPU artifact, downloads and verifies the DMG, then opens it; you complete installation by dragging Workflow Studio to Applications. On Windows, the script downloads and verifies the x64 NSIS executable, then launches the installer flow automatically. The installed app verifies first-party Tauri updater signatures before applying updates; those signatures are separate from operating-system publisher signing.

Each script chooses only an exact OS/architecture filename, downloads `SHA256SUMS` from the matching release tag, computes SHA-256 locally, and launches only after an exact match. A mismatch stops installation. Linux and unsupported architectures fail clearly without downloading or launching an installer.

## Direct download and verification

Download the installer and `SHA256SUMS` from the same GitHub release. Find the exact filename as a two-space-delimited entry in `SHA256SUMS`, then compare it with `sha256sum`, `shasum -a 256`, or PowerShell `Get-FileHash -Algorithm SHA256`. Do not use a checksum from another tag.

### macOS unsigned warning

Open the DMG and drag Workflow Studio to Applications. On first launch, macOS may say the developer cannot be verified. Do not disable Gatekeeper. In Finder, Control-click or Right-click Workflow Studio, choose **Open**, review the warning, and choose **Open** again. This exception applies only to this app.

### Windows unsigned warning

Run the NSIS setup executable. Microsoft Defender SmartScreen may show “Windows protected your PC.” Do not change system security policy. Verify the checksum, select **More info**, confirm the displayed app name, and choose **Run anyway**. The installer is x64-only for version one.

### Linux

Linux packaging is deferred. The immutable v1.0.5 bootstrap does not support Linux, published v1.0.6 has no Linux fallback artifact, and the v1.0.7 candidate does not add one.

## First launch, Git, and updates

First launch verifies the bundled offline contract, examples, and LOOP24 resources, then checks whether Git is available. Git is recommended for local workflow versions but is not required for YAML authoring. No Hermes, Node, or Python runtime is installed.

Manual update checks are available in Settings > About. Optional bounded startup checks do not block offline work. Updates download the exact OS/architecture updater artifact, verify the first-party Tauri updater signature, install it, and request a relaunch. This updater signature is not Apple or Microsoft publisher signing.

## Install and app-data locations

- macOS app: normally `/Applications/LOOP24 Workflow Studio.app`; data under `~/Library/Application Support/com.cmetech.workflowstudio`.
- Windows app: the per-user location selected by NSIS; data under `%APPDATA%\com.cmetech.workflowstudio`.

Workspace YAML remains wherever you created it. Layout, settings, setup/update logs, recovery drafts, cached resources, and imported brand packs live under app data.

## Uninstall

- macOS: quit the app and move it from Applications to Trash.
- Windows: use Settings > Apps > Installed apps and uninstall LOOP24 Workflow Studio.

Uninstalling the executable does not delete workspace YAML or app data. Remove the exact app-data directory separately only if you intentionally want to discard local settings, layout, logs, and recovery drafts.
