import { execFileSync } from 'node:child_process'

/**
 * Returns the workspace packages that are published to npm, so not the private root and private packages.
 */
export function getPublishedWorkspacePackages(cwd) {
  const output = execFileSync('pnpm', ['ls', '--recursive', '--depth', '-1', '--json'], { cwd, encoding: 'utf8' })

  return JSON.parse(output)
    .filter((workspacePackage) => !workspacePackage.private)
    .map(({ name, path }) => ({ name, path }))
}
