import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return String(port);
}

test('setup reports an unwritable database and stops; rerunning after permission repair saves settings', {
  skip: !['linux', 'darwin'].includes(process.platform) || typeof process.getuid !== 'function' || process.getuid() === 0
    ? 'requires Linux/macOS, Bash and a non-root user for read-only file permissions'
    : false,
}, async () => {
  const dir = await mkdtemp(join(root, '.setup-test-'));
  const dbPath = join(dir, 'data', 'geovista.db');
  let originalMode;
  try {
    await copyFile(join(root, 'setup.sh'), join(dir, 'setup.sh'));
    await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    await mkdir(join(dir, 'bin'));
    // Node, @libsql/client and setup.sh are real; only the production build is replaced.
    await writeFile(join(dir, 'bin', 'npm'), '#!/usr/bin/env bash\nprintf "build\\n" >> build-calls\n', { mode: 0o755 });
    // Never let setup's port handling signal a process, even if port selection races.
    const guard = join(dir, 'shell-guard');
    await writeFile(guard, 'kill() { printf "Blocked process signal in setup test\\n" >&2; exit 97; }\n');
    const env = {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${dirname(process.execPath)}:${process.env.PATH}`,
      BASH_ENV: guard,
      TERM: 'dumb',
    };
    const setup = (url, port) => spawnSync('bash', ['setup.sh'], {
      cwd: dir, env, input: `${url}\n${port}\nn\n`, encoding: 'utf8', timeout: 30000,
    });
    const settings = async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const result = await client.execute('SELECT key, value FROM app_settings');
        return Object.fromEntries(result.rows.map(row => [row.key, row.value]));
      } finally {
        client.close();
      }
    };

    const oldUrl = 'http://127.0.0.1:1/geoserver';
    const oldPort = await unusedPort();
    const first = setup(oldUrl, oldPort);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const before = await settings();
    assert.equal(before.geoserver_url, oldUrl);
    assert.equal(before.app_port, oldPort);
    assert.equal(before.tileserv_url, 'http://localhost:7800');
    assert.equal(Buffer.from(before.jwt_secret, 'base64').length, 64);
    await rm(join(dir, 'build-calls'));
    await mkdir(join(dir, '.next'));
    await writeFile(join(dir, '.next', 'keep'), 'previous build');
    originalMode = (await stat(dbPath)).mode & 0o777;
    await chmod(dbPath, 0o444);
    const readOnlyClient = createClient({ url: `file:${dbPath}` });
    try {
      await assert.rejects(
        readOnlyClient.execute({
          sql: 'UPDATE app_settings SET value = ? WHERE key = ?',
          args: ['write-must-fail', 'geoserver_url'],
        }),
        error => error.code === 'SQLITE_READONLY',
        'SQLite itself must reject writes before testing setup failure',
      );
    } finally {
      readOnlyClient.close();
    }

    const newUrl = 'http://127.0.0.1:2/geoserver';
    const newPort = await unusedPort();
    const failed = setup(newUrl, newPort);
    assert.equal(failed.error, undefined);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stderr, /SQLITE_READONLY/);
    assert.match(failed.stderr, /Could not save configuration/);
    assert.doesNotMatch(failed.stdout, /Configuration saved|SETUP COMPLETED SUCCESSFULLY/);
    await assert.rejects(readFile(join(dir, 'build-calls')), { code: 'ENOENT' });
    assert.equal(await readFile(join(dir, '.next', 'keep'), 'utf8'), 'previous build');
    const unchanged = await settings();
    assert.ok(JSON.stringify(unchanged) === JSON.stringify(before), 'all saved settings remain unchanged');

    await chmod(dbPath, originalMode);
    const recovered = setup(newUrl, newPort);
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    const after = await settings();
    assert.equal(after.geoserver_url, newUrl);
    assert.equal(after.app_port, newPort);
    assert.ok(after.jwt_secret === before.jwt_secret, 'rerun preserves JWT secret');
    assert.equal(await readFile(join(dir, 'build-calls'), 'utf8'), 'build\n');
  } finally {
    try {
      if (originalMode !== undefined) await chmod(dbPath, originalMode);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
