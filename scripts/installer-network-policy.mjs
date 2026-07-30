const EXPECTED_SHELL_DESTINATIONS = ['$API_URL', '$RELEASE_ROOT/$TAG/$INSTALLER_NAME', '$RELEASE_ROOT/$TAG/SHA256SUMS']

const EXPECTED_POWERSHELL_DESTINATIONS = ['$ApiUrl', '$ReleaseRoot/$Tag/$InstallerName', '$ReleaseRoot/$Tag/SHA256SUMS']

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

  const shell = shellDestinations(shellSource)
  const powershell = powershellDestinations(powershellSource)
  requireExact(shell, EXPECTED_SHELL_DESTINATIONS, 'shell')
  requireExact(powershell, EXPECTED_POWERSHELL_DESTINATIONS, 'PowerShell')
  return { shell, powershell }
}

function shellDestinations(source) {
  const logicalLines = source.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/)
  return logicalLines.flatMap((line) => {
    if (!/\bcurl\b/.test(line) || /^\s*command\s+-v\s+curl\b/.test(line)) return []
    const command = line.split(/\s+\|\|/u, 1)[0]
    const quoted = [...command.matchAll(/(["'])(.*?)\1/g)].map((match) => match[2])
    const destination = quoted.at(-1)
    if (!destination) throw new Error('Unapproved installer network destination: curl has no literal expression.')
    return [destination]
  })
}

function powershellDestinations(source) {
  return [...source.matchAll(/^.*?\bInvoke-(?:RestMethod|WebRequest)\b([^\r\n]*)/gim)].map((match) => {
    const destination = match[1].match(/-Uri\s+(?:"([^"]+)"|'([^']+)'|(\$[A-Za-z_][A-Za-z0-9_]*))/i)
    const value = destination?.[1] ?? destination?.[2] ?? destination?.[3]
    if (!value) throw new Error('Unapproved installer network destination: Invoke-* has no literal -Uri expression.')
    return value
  })
}

function requireMatch(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`Unapproved installer network destination: ${label} changed.`)
}

function requireExact(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`Unapproved installer network destination in ${label}: ${actual.join(', ')}`)
  }
}
