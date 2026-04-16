#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================
// @relayon/mcp — publish preflight
//
// Runs as `prepublishOnly`. Hard-fails `npm publish` if any of the
// shipping invariants are violated. Cheap, local, no network calls
// except a single HEAD to the npm registry to guard against a
// version-already-published collision.
// =============================================

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const pkg  = require(path.join(ROOT, 'package.json'));

const checks = [];
let failed = 0;

function ok(label)           { checks.push({ ok: true,  label }); }
function fail(label, detail) { checks.push({ ok: false, label, detail }); failed++; }

// ─────────────────────────────────────────────────────────────
// 1. package.json sanity
// ─────────────────────────────────────────────────────────────
if (!pkg.name || !pkg.name.startsWith('@relayon/')) {
  fail('package.name', `expected @relayon/*, got ${pkg.name}`);
} else {
  ok(`package.name = ${pkg.name}`);
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pkg.version)) {
  fail('package.version', `not semver: ${pkg.version}`);
} else {
  ok(`package.version = ${pkg.version}`);
}

if (pkg.publishConfig && pkg.publishConfig.access === 'public') {
  ok('publishConfig.access = public (scoped pkg will be published publicly)');
} else {
  fail('publishConfig.access', 'scoped packages default to private — set publishConfig.access = "public"');
}

if (!pkg.license) fail('license', 'missing license field'); else ok(`license = ${pkg.license}`);
if (!pkg.repository) fail('repository', 'missing repository field'); else ok('repository present');

// ─────────────────────────────────────────────────────────────
// 2. Build artefacts
// ─────────────────────────────────────────────────────────────
const distDir  = path.join(ROOT, 'dist');
const binFile  = path.join(distDir, 'index.js');
const readme   = path.join(ROOT, 'README.md');
const license  = path.join(ROOT, 'LICENSE');

if (!fs.existsSync(distDir)) {
  fail('dist/', 'not found — did `npm run build` run?');
} else {
  ok('dist/ exists');
}

if (!fs.existsSync(binFile)) {
  fail('dist/index.js', 'missing bin entry');
} else {
  const first = fs.readFileSync(binFile, 'utf8').split('\n', 1)[0];
  if (!first.startsWith('#!')) {
    fail('dist/index.js shebang', `first line is "${first}", expected #!/usr/bin/env node`);
  } else {
    ok(`dist/index.js shebang = ${first}`);
  }

  try {
    fs.accessSync(binFile, fs.constants.X_OK);
    ok('dist/index.js is executable');
  } catch {
    fail('dist/index.js permissions', 'not executable — build step should chmod +x it');
  }
}

if (!fs.existsSync(readme))  fail('README.md', 'missing');  else ok('README.md present');
if (!fs.existsSync(license)) fail('LICENSE',   'missing');  else ok('LICENSE present');

// ─────────────────────────────────────────────────────────────
// 3. No accidental source-code secrets
// ─────────────────────────────────────────────────────────────
const SECRET_PATTERNS = [
  /rl_live_[A-Za-z0-9]{16,}/,       // Relayon live key
  /sk-[A-Za-z0-9]{20,}/,             // common API-key shape
  /AKIA[0-9A-Z]{16}/,                // AWS access key id
];

function scanForSecrets(dir) {
  const hits = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      hits.push(...scanForSecrets(p));
    } else if (/\.(ts|js|json|md)$/.test(entry.name)) {
      const body = fs.readFileSync(p, 'utf8');
      for (const re of SECRET_PATTERNS) {
        const m = body.match(re);
        if (m) hits.push(`${path.relative(ROOT, p)}: ${m[0].slice(0, 12)}…`);
      }
    }
  }
  return hits;
}
const secretHits = scanForSecrets(ROOT);
if (secretHits.length) {
  fail('secret scan', 'found patterns that look like live credentials:\n        - ' + secretHits.join('\n        - '));
} else {
  ok('secret scan clean');
}

// ─────────────────────────────────────────────────────────────
// 4. Git working tree (warn-only unless ALLOW_DIRTY=1)
// ─────────────────────────────────────────────────────────────
try {
  const status = execSync('git status --porcelain', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  if (!status) {
    ok('git working tree clean');
  } else if (process.env.ALLOW_DIRTY === '1') {
    ok('git working tree dirty (ALLOW_DIRTY=1 — override honoured)');
  } else {
    fail('git working tree', 'dirty — commit/stash first, or rerun with ALLOW_DIRTY=1\n' + status);
  }
} catch {
  ok('git not available — skipping working-tree check');
}

// ─────────────────────────────────────────────────────────────
// 5. Registry version collision (remote HEAD; skip with SKIP_REMOTE=1)
// ─────────────────────────────────────────────────────────────
function headRegistry(name, version) {
  return new Promise(resolve => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}/${version}`;
    const req = https.request(url, { method: 'HEAD', timeout: 4000 }, res => resolve(res.statusCode));
    req.on('error',   () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

(async () => {
  if (process.env.SKIP_REMOTE !== '1') {
    const code = await headRegistry(pkg.name, pkg.version);
    if (code === 200) {
      fail('registry collision', `${pkg.name}@${pkg.version} is already published — bump the version`);
    } else if (code === 404) {
      ok(`registry: ${pkg.name}@${pkg.version} not yet published`);
    } else {
      ok(`registry check skipped (HTTP ${code ?? 'offline'})`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Report
  // ─────────────────────────────────────────────────────────────
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  console.log('\n  @relayon/mcp — publish preflight\n  ' + '─'.repeat(60));
  for (const c of checks) {
    const mark = c.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${mark}  ${pad(c.label, 52)}${c.ok ? '' : '\n       ' + (c.detail || '').split('\n').join('\n       ')}`);
  }
  console.log('  ' + '─'.repeat(60));
  if (failed) {
    console.error(`\n  \x1b[31m${failed} check(s) failed — aborting publish.\x1b[0m\n`);
    process.exit(1);
  }
  console.log('  \x1b[32mAll checks passed — safe to publish.\x1b[0m\n');
})();
