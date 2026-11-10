import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Packages the UI cassette into dist/angel-armor-ui-<version>.tar.gz.
 *
 * The archive root is `package/` so `npm install ./angel-armor-ui-1.0.0.tar.gz`
 * treats it exactly like an `npm pack` tarball. Run from the repository root:
 *
 *   node scripts/export-ui.ts      (Node 22.6+ strips the types)
 *
 * Uses the system `tar`; on Windows, Git Bash and Windows 10+ both ship one.
 */

interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const allowedPeers = new Set(['react', 'react-dom']);

function fail(message: string): never {
  console.error(`[ui] ${message}`);
  process.exit(1);
}

const repoRoot = process.cwd();
const packageDir = path.join(repoRoot, 'packages', 'angel-armor-ui');
const packageJsonPath = path.join(packageDir, 'package.json');

if (!existsSync(packageJsonPath)) {
  fail(`cannot find ${path.relative(repoRoot, packageJsonPath)}; run this from the repository root`);
}

const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest;

// The cassette contract: nothing but React peers, and no engine imports.
if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
  fail(`package must not declare dependencies (found ${Object.keys(manifest.dependencies).join(', ')})`);
}

for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
  if (!allowedPeers.has(peer)) {
    fail(`unexpected peer dependency "${peer}" (only react and react-dom are allowed)`);
  }
}

if (manifest.name !== '@deepdrop/angel-armor-ui') {
  fail(`unexpected package name "${manifest.name}"`);
}

const srcDir = path.join(packageDir, 'src');
const forbidden: string[] = [];
const engineImport = /from\s+['"](?:\.\.\/)+src\/|require\(['"](?:\.\.\/)+src\/|@deepdrop\/aperture|['"]aperture['"]/;

for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) {
    continue;
  }
  const source = readFileSync(path.join(srcDir, entry.name), 'utf8');
  if (engineImport.test(source)) {
    forbidden.push(entry.name);
  }
}

if (forbidden.length > 0) {
  fail(`src/ must not import the engine: ${forbidden.join(', ')}`);
}

const distDir = path.join(repoRoot, 'dist');
const stagingDir = path.join(distDir, '.ui-pack');
const stagedPackage = path.join(stagingDir, 'package');
const tarballName = `angel-armor-ui-${manifest.version}.tar.gz`;
const tarballPath = path.join(distDir, tarballName);

mkdirSync(distDir, { recursive: true });
rmSync(stagingDir, { recursive: true, force: true });
rmSync(tarballPath, { force: true });
mkdirSync(stagedPackage, { recursive: true });

cpSync(packageJsonPath, path.join(stagedPackage, 'package.json'));
cpSync(path.join(packageDir, 'README.md'), path.join(stagedPackage, 'README.md'));
cpSync(srcDir, path.join(stagedPackage, 'src'), { recursive: true });

try {
  execFileSync('tar', ['-czf', tarballPath, '-C', stagingDir, 'package'], { stdio: 'inherit' });
} catch {
  rmSync(stagingDir, { recursive: true, force: true });
  fail('the system `tar` command is required to export the cassette');
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
}

const bytes = statSync(tarballPath).size;
const sha256 = createHash('sha256').update(readFileSync(tarballPath)).digest('hex');
const relative = path.relative(repoRoot, tarballPath).split(path.sep).join('/');

console.log(`[ui] packaged ${manifest.name}@${manifest.version}`);
console.log(`[ui] ${relative} (${(bytes / 1024).toFixed(1)} KiB)`);
console.log(`[ui] sha256 ${sha256}`);
console.log(`[ui] install with: npm install ./${relative}`);
