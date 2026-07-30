import { createHash } from 'node:crypto'

const EXPECTED_SHELL_SHA256 = '2a0cc7fda53a53d6a36cf6ad19ac76485fb4941684aa0d388a999b1ce29466ce'
const EXPECTED_POWERSHELL_SHA256 = 'e6233cdeaf1c680245b0e87a3c01ae17f37514d1d4a72623d7415c5147d4a4ed'

const EXPECTED_SHELL_DESTINATIONS = ['$API_URL', '$RELEASE_ROOT/$TAG/$INSTALLER_NAME', '$RELEASE_ROOT/$TAG/SHA256SUMS']

const EXPECTED_POWERSHELL_DESTINATIONS = ['$ApiUrl', '$ReleaseRoot/$Tag/$InstallerName', '$ReleaseRoot/$Tag/SHA256SUMS']

const EXPECTED_SHELL_URL_LITERALS = [
  'https://api.github.com/repos/${REPOSITORY}/releases/latest',
  'https://github.com/${REPOSITORY}/releases/download',
]

const EXPECTED_POWERSHELL_URL_LITERALS = [
  'https://api.github.com/repos/$Repository/releases/latest',
  'https://github.com/$Repository/releases/download',
]

const EXPECTED_SHELL_COMMANDS = [
  `RELEASE_JSON=$(curl --fail --silent --show-error --location --header 'Accept: application/vnd.github+json' --header 'X-GitHub-Api-Version: 2022-11-28' "$API_URL")`,
  'curl --fail --show-error --location --output "$INSTALLER_PATH" "$RELEASE_ROOT/$TAG/$INSTALLER_NAME"',
  'curl --fail --show-error --location --output "$CHECKSUM_PATH" "$RELEASE_ROOT/$TAG/SHA256SUMS"',
]

const EXPECTED_POWERSHELL_COMMANDS = [
  '$Release = Invoke-RestMethod -Uri $ApiUrl -Headers $Headers',
  'Invoke-WebRequest -Uri "$ReleaseRoot/$Tag/$InstallerName" -OutFile $InstallerPath -UseBasicParsing',
  'Invoke-WebRequest -Uri "$ReleaseRoot/$Tag/SHA256SUMS" -OutFile $ChecksumPath -UseBasicParsing',
]

export function verifyInstallerNetworkPolicy(shellSource, powershellSource) {
  requireMatch(shellSource, /^REPOSITORY="cmetech\/workflow-studio"$/m, 'shell repository')
  requireMatch(
    shellSource,
    /^API_URL="https:\/\/api\.github\.com\/repos\/\$\{REPOSITORY\}\/releases\/latest"$/m,
    'shell API root',
  )
  requireMatch(
    shellSource,
    /^RELEASE_ROOT="https:\/\/github\.com\/\$\{REPOSITORY\}\/releases\/download"$/m,
    'shell release root',
  )
  requireMatch(powershellSource, /^\$Repository = 'cmetech\/workflow-studio'$/m, 'PowerShell repository')
  requireMatch(
    powershellSource,
    /^\$ApiUrl = "https:\/\/api\.github\.com\/repos\/\$Repository\/releases\/latest"$/m,
    'PowerShell API root',
  )
  requireMatch(
    powershellSource,
    /^\$ReleaseRoot = "https:\/\/github\.com\/\$Repository\/releases\/download"$/m,
    'PowerShell release root',
  )
  requireAbsent(shellSource, /\bwget\b|\bpython(?:3)?\b[^\r\n]*\burllib\b/iu, 'unsupported shell downloader')
  requireAbsent(
    powershellSource,
    /\b(?:iwr|irm)\b|\bWebClient\b|\bHttpClient\b|\bStart-BitsTransfer\b/iu,
    'unsupported PowerShell downloader',
  )
  requireExact(urlLiterals(shellSource), EXPECTED_SHELL_URL_LITERALS, 'shell URL literals')
  requireExact(urlLiterals(powershellSource), EXPECTED_POWERSHELL_URL_LITERALS, 'PowerShell URL literals')

  const shellCommands = shellNetworkCommands(shellSource)
  const powershellCommands = powershellNetworkCommands(powershellSource)
  requireExact(shellCommands, EXPECTED_SHELL_COMMANDS, 'shell command forms')
  requireExact(powershellCommands, EXPECTED_POWERSHELL_COMMANDS, 'PowerShell command forms')
  const shell = shellCommands.map(quotedDestination)
  const powershell = powershellCommands.map(powershellDestination)
  requireExact(shell, EXPECTED_SHELL_DESTINATIONS, 'shell')
  requireExact(powershell, EXPECTED_POWERSHELL_DESTINATIONS, 'PowerShell')
  requireAuditedScript(shellSource, EXPECTED_SHELL_SHA256, 'shell')
  requireAuditedScript(powershellSource, EXPECTED_POWERSHELL_SHA256, 'PowerShell')
  return { shell, powershell }
}

function shellNetworkCommands(source) {
  const logicalLines = source.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/)
  return logicalLines.flatMap((line) => {
    const command = normalizeCommand(line.split(/\s+\|\|/u, 1)[0] ?? '')
    const curlCount = [...command.matchAll(/\bcurl\b/gu)].length
    if (curlCount === 0 || /^command -v curl\b/u.test(command)) return []
    if (curlCount !== 1) throw new Error('Unapproved installer network destination: multiple curl invocations.')
    return [command]
  })
}

function powershellNetworkCommands(source) {
  return source
    .split(/\r?\n/u)
    .filter((line) => /\bInvoke-[A-Za-z][A-Za-z0-9-]*\b/iu.test(line))
    .map(normalizeCommand)
}

function quotedDestination(command) {
  const quoted = [...command.matchAll(/(["'])(.*?)\1/gu)].map((match) => match[2])
  const destination = quoted.at(-1)
  if (!destination) throw new Error('Unapproved installer network destination: curl has no literal expression.')
  return destination
}

function powershellDestination(command) {
  const destination = command.match(/-Uri\s+(?:"([^"]+)"|'([^']+)'|(\$[A-Za-z_][A-Za-z0-9_]*))/iu)
  const value = destination?.[1] ?? destination?.[2] ?? destination?.[3]
  if (!value) throw new Error('Unapproved installer network destination: Invoke-* has no literal -Uri expression.')
  return value
}

function urlLiterals(source) {
  return [...source.matchAll(/https?:\/\/[^\s"'`)]+/gu)].map((match) => match[0])
}

function normalizeCommand(value) {
  return value.trim().replaceAll(/\s+/gu, ' ')
}

function requireMatch(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`Unapproved installer network destination: ${label} changed.`)
}

function requireAbsent(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`Unapproved installer network destination: ${label}.`)
}

function requireExact(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`Unapproved installer network destination in ${label}: ${actual.join(', ')}`)
  }
}

function requireAuditedScript(source, expectedSha256, label) {
  const normalized = source.replaceAll('\r\n', '\n')
  const actualSha256 = createHash('sha256').update(normalized).digest('hex')
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Unapproved installer network destination: ${label} installer content changed.`)
  }
}
