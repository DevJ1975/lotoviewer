// Learn more https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// 1. Tell Metro to also watch the monorepo root so changes inside
//    packages/core trigger a rebuild.
config.watchFolders = [monorepoRoot]

// 2. Resolve modules from BOTH the app's own node_modules and the
//    hoisted root node_modules (npm workspaces hoists shared deps).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

// 3. Force Metro to walk up to find dependencies. Without this,
//    workspace symlinks (e.g. @soteria/core) can fail to resolve.
config.resolver.disableHierarchicalLookup = false

module.exports = config
