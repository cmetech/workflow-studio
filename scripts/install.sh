#!/bin/sh

set -efu

REPOSITORY="cmetech/workflow-studio"
API_URL="https://api.github.com/repos/${REPOSITORY}/releases/latest"
RELEASE_ROOT="https://github.com/${REPOSITORY}/releases/download"

status() {
  printf '%s\n' "Workflow Studio: $*"
}

fail() {
  printf '%s\n' "Workflow Studio install failed: $*" >&2
  exit 1
}

OS_NAME=$(uname -s)
ARCH_NAME=$(uname -m)
case "$OS_NAME/$ARCH_NAME" in
  Darwin/arm64 | Darwin/aarch64)
    ASSET_SUFFIX="macos_aarch64.dmg"
    ;;
  Darwin/x86_64)
    ASSET_SUFFIX="macos_x86_64.dmg"
    ;;
  Linux/*)
    fail "This installer supports macOS only; download the Windows installer from GitHub Releases"
    ;;
  Darwin/*)
    fail "Unsupported architecture: $ARCH_NAME on $OS_NAME"
    ;;
  *)
    fail "Unsupported operating system: $OS_NAME"
    ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is required"

status "checking the latest public release"
RELEASE_JSON=$(curl --fail --silent --show-error --location \
  --header 'Accept: application/vnd.github+json' \
  --header 'X-GitHub-Api-Version: 2022-11-28' \
  "$API_URL") || fail "could not query GitHub Releases"
TAG=$(printf '%s\n' "$RELEASE_JSON" | sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"\(v[0-9][0-9A-Za-z.-]*\)"[,[:space:]]*$/\1/p' | head -n 1)
VERSION=${TAG#v}
case "$VERSION" in
  *[!0-9A-Za-z.-]*) fail "latest release returned an unsafe version" ;;
esac
CORE_VERSION=${VERSION%%-*}
if [ "$CORE_VERSION" = "$VERSION" ]; then
  PRERELEASE=""
else
  PRERELEASE=${VERSION#"$CORE_VERSION-"}
  case "$PRERELEASE" in
    "" | [!0-9A-Za-z]* | *[!0-9A-Za-z.-]*) fail "latest release returned an invalid tag" ;;
  esac
fi
VERSION_MAJOR=""
VERSION_MINOR=""
VERSION_PATCH=""
VERSION_EXTRA=""
IFS=. read -r VERSION_MAJOR VERSION_MINOR VERSION_PATCH VERSION_EXTRA <<EOF
$CORE_VERSION
EOF
[ -z "$VERSION_EXTRA" ] || fail "latest release returned an invalid tag"
for VERSION_COMPONENT in "$VERSION_MAJOR" "$VERSION_MINOR" "$VERSION_PATCH"; do
  case "$VERSION_COMPONENT" in
    "" | *[!0-9]*) fail "latest release returned an invalid tag" ;;
    0) ;;
    0*) fail "latest release returned an invalid tag" ;;
  esac
done

INSTALLER_NAME="LOOP24-Workflow-Studio_${VERSION}_${ASSET_SUFFIX}"
TEMP_ROOT=${TMPDIR:-/tmp}
TEMP_DIR=$(mktemp -d "${TEMP_ROOT%/}/loop24-workflow-studio.XXXXXX") || fail "could not create a temporary directory"
case "$TEMP_DIR" in
  "${TEMP_ROOT%/}"/loop24-workflow-studio.*) ;;
  *) fail "temporary directory was outside the expected root" ;;
esac
INSTALLER_PATH="$TEMP_DIR/$INSTALLER_NAME"
CHECKSUM_PATH="$TEMP_DIR/SHA256SUMS"
cleanup() {
  rm -f -- "$INSTALLER_PATH" "$CHECKSUM_PATH"
  rmdir -- "$TEMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

status "downloading $INSTALLER_NAME"
curl --fail --show-error --location --output "$INSTALLER_PATH" \
  "$RELEASE_ROOT/$TAG/$INSTALLER_NAME" || fail "installer download failed"
curl --fail --show-error --location --output "$CHECKSUM_PATH" \
  "$RELEASE_ROOT/$TAG/SHA256SUMS" || fail "checksum download failed"

EXPECTED_CHECKSUM=$(awk -v wanted="$INSTALLER_NAME" '
  $1 ~ /^[0-9a-f]{64}$/ && $2 == wanted { print $1; count += 1 }
  END { if (count != 1) exit 1 }
' "$CHECKSUM_PATH") || fail "checksum manifest does not contain exactly one entry for $INSTALLER_NAME"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_CHECKSUM=$(sha256sum "$INSTALLER_PATH" | awk '{ print $1 }')
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_CHECKSUM=$(shasum -a 256 "$INSTALLER_PATH" | awk '{ print $1 }')
else
  fail "sha256sum or shasum is required"
fi
[ "$EXPECTED_CHECKSUM" = "$ACTUAL_CHECKSUM" ] || fail "SHA-256 verification failed"
status "SHA-256 verified"

status "opening the unsigned DMG; use right-click > Open if macOS blocks first launch"
open "$INSTALLER_PATH"
trap - EXIT HUP INT TERM
status "the verified DMG remains at $INSTALLER_PATH while it is open"
