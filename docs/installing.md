# Installing Workflow Studio

Workflow Studio publishes native installers from the public `cmetech/workflow-studio` GitHub Releases page. The application does not have an Apple Developer ID signature, Apple notarization, or a Microsoft Authenticode signature. The release workflow does publish `SHA256SUMS`, and the in-app updater uses a separate first-party cryptographic signature to prevent modified update artifacts from installing.

## Supported targets

| Operating system | Architecture | Artifact |
|---|---|---|
| macOS | Apple Silicon | `LOOP24-Workflow-Studio_<version>_macos_aarch64.dmg` |
| macOS | Intel | `LOOP24-Workflow-Studio_<version>_macos_x86_64.dmg` |
| Windows | x64 | `LOOP24-Workflow-Studio_<version>_windows_x86_64-setup.exe` |
| Linux | x64 | `LOOP24-Workflow-Studio_<version>_linux_x86_64.AppImage` |

Windows ARM64 and Linux ARM64 are not silently redirected to x64 packages. They will be advertised only after native builds and installation acceptance succeed.

## One-line download and install

These commands save the public installer script to a new temporary file before running it. They do not pipe a network response directly into a shell. Review [the shell script](../scripts/install.sh) or [the PowerShell script](../scripts/install.ps1) first if that is your policy.

macOS or Linux:

```sh
p=$(mktemp) && curl --fail --location https://raw.githubusercontent.com/cmetech/workflow-studio/2a0ec9f5c5bd95f693d8b97599653700d1471f0c/scripts/install.sh --output "$p" && sh "$p"; s=$?; rm -f "$p"; exit $s
```

Windows PowerShell:

```powershell
$p=Join-Path ([IO.Path]::GetTempPath()) "workflow-studio-install-$([Guid]::NewGuid().ToString('N')).ps1"; Invoke-RestMethod https://raw.githubusercontent.com/cmetech/workflow-studio/2a0ec9f5c5bd95f693d8b97599653700d1471f0c/scripts/install.ps1 -OutFile $p; try { & $p } finally { Remove-Item -LiteralPath $p -Force }
```

Both commands pin the bootstrap script to an immutable, reviewed repository commit. That trust decision does not automatically adopt later bootstrap-script changes: maintainers must review the new script and update this documentation to a new commit. The pinned script still selects the latest published app release, whose installer checksum and updater signature are verified independently.

Each script obtains the exact latest release tag from GitHub, chooses only an exact OS/architecture filename, downloads `SHA256SUMS` from that same tag, computes SHA-256 locally, and launches only after an exact match. A mismatch stops installation.

## Direct download and verification

Download the installer and `SHA256SUMS` from the same GitHub release. Find the exact filename as a two-space-delimited entry in `SHA256SUMS`, then compare it with `sha256sum`, `shasum -a 256`, or PowerShell `Get-FileHash -Algorithm SHA256`. Do not use a checksum from another tag.

### macOS unsigned warning

Open the DMG and drag Workflow Studio to Applications. On first launch, macOS may say the developer cannot be verified. Do not disable Gatekeeper. In Finder, Control-click or Right-click Workflow Studio, choose **Open**, review the warning, and choose **Open** again. This exception applies only to this app.

### Windows unsigned warning

Run the NSIS setup executable. Microsoft Defender SmartScreen may show “Windows protected your PC.” Do not change system security policy. Verify the checksum, select **More info**, confirm the displayed app name, and choose **Run anyway**. The installer is x64-only for version one.

### Linux AppImage

The downloader verifies the AppImage, atomically installs it as `$XDG_BIN_HOME/loop24-workflow-studio.AppImage` or `~/.local/bin/loop24-workflow-studio.AppImage`, marks it executable, and launches it. For a direct download, run `chmod 700 LOOP24-Workflow-Studio_<version>_linux_x86_64.AppImage` and keep the file in a location you control. Desktop integration depends on the distribution.

## First launch, Git, and updates

First launch verifies the bundled offline contract, examples, and LOOP24 resources, then checks whether Git is available. Git is recommended for local workflow versions but is not required for YAML authoring. No Hermes, Node, or Python runtime is installed.

Manual update checks are available in Settings > About. Optional bounded startup checks do not block offline work. Updates download the exact OS/architecture updater artifact, verify the first-party Tauri updater signature, install it, and request a relaunch. This updater signature is not Apple or Microsoft publisher signing.

## Install and app-data locations

- macOS app: normally `/Applications/LOOP24 Workflow Studio.app`; data under `~/Library/Application Support/com.cmetech.workflowstudio`.
- Windows app: the per-user location selected by NSIS; data under `%APPDATA%\com.cmetech.workflowstudio`.
- Linux app: the AppImage location you select; data under `$XDG_DATA_HOME/com.cmetech.workflowstudio` or `~/.local/share/com.cmetech.workflowstudio`.

Workspace YAML remains wherever you created it. Layout, settings, setup/update logs, recovery drafts, cached resources, and imported brand packs live under app data.

## Uninstall

- macOS: quit the app and move it from Applications to Trash.
- Windows: use Settings > Apps > Installed apps and uninstall LOOP24 Workflow Studio.
- Linux: quit the app and remove `$XDG_BIN_HOME/loop24-workflow-studio.AppImage` or `~/.local/bin/loop24-workflow-studio.AppImage`.

Uninstalling the executable does not delete workspace YAML or app data. Remove the exact app-data directory separately only if you intentionally want to discard local settings, layout, logs, and recovery drafts.
