import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const mocks = path.join(root, 'mocks');
  mkdirSync(repo); mkdirSync(mocks);
  for (const name of ['Makefile', 'agents']) cpSync(path.join(source, name), path.join(repo, name), { recursive: true });
  // Skip host login profiles so the test's mocked PATH is preserved.
  writeFileSync(path.join(mocks, 'bash'), '#!/bin/bash\nif [[ $1 == -lc ]]; then exec /bin/bash -c "$2" "${@:3}"; fi\nexec /bin/bash "$@"\n', { mode: 0o755 });
  writeFileSync(path.join(mocks, 'apptainer'), `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'build') {
  if (process.env.FAIL_BUILD) process.exit(7);
  if (!fs.existsSync(args.at(-1))) process.exit(8);
  fs.writeFileSync(args.at(-2), JSON.stringify(args));
} else {
  const bind = args[args.indexOf('--bind') + 1];
  const runtime = bind.split(':')[0];
  fs.writeFileSync(process.env.CAPTURE, JSON.stringify({args, runtime,
    config: fs.readFileSync(runtime + '/config.json', 'utf8'),
    sqlite: fs.existsSync(runtime + '/state.sqlite'),
    token: process.env.APPTAINERENV_COPILOT_GITHUB_TOKEN}));
  process.exit(Number(process.env.CLI_EXIT || 0));
}
`, { mode: 0o755 });
  const env = { ...process.env, PATH: mocks + path.delimiter + process.env.PATH };
  delete env.MAKEFLAGS; delete env.MAKEOVERRIDES; delete env.MFLAGS;
  return {root, repo, env};
}
function run(command, args, f, extra = {}) {
  return spawnSync(command, args, {cwd: f.repo, env: {...f.env, ...extra}, encoding: 'utf8'});
}
for (const agent of ['codex', 'copilot']) {
  test(`${agent}: builds locally, installs independently, and preserves version selection`, t => {
    const f = fixture(t);
    const home = path.join(f.root, 'install');
    const sif = path.join(f.root, 'images', agent + '.sif');
    const args = [`AGENT=${agent}`, `HOME=${home}`, `SLURM_SANDBOX=${sif}`, 'AGENT_VERSION=1.2.3'];
    let result = run('make', ['build', ...args], f);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(home), false);
    const output = path.join(f.repo, agent + '.sif');
    const build = JSON.parse(readFileSync(output));
    assert.ok(build.includes(`${agent.toUpperCase()}_VERSION=1.2.3`));
    assert.ok(!build.includes('--sandbox'));
    result = run('make', ['server_build', ...args], f);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(sif, 'utf8'), readFileSync(output, 'utf8'));
    const installed = path.join(home, 'bin', agent);
    assert.equal(readFileSync(installed, 'utf8'), readFileSync(path.join(f.repo, 'agents', agent, 'launcher'), 'utf8'));
    assert.ok(statSync(installed).mode & 0o111);
    writeFileSync(sif, 'previous image');
    result = run('make', ['server_build', ...args], f, {FAIL_BUILD: '1'});
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(sif, 'utf8'), 'previous image');
  });
  test(`${agent}: launcher binds config, forwards arguments, and cleans up on failure`, t => {
    const f = fixture(t);
    const config = path.join(f.root, 'config'); mkdirSync(config);
    writeFileSync(path.join(config, 'config.json'), '{}');
    writeFileSync(path.join(config, 'state.sqlite'), 'excluded');
    const sif = path.join(f.root, 'test.sif'); writeFileSync(sif, 'mock');
    const capture = path.join(f.root, 'capture.json');
    const env = {AGENT_SANDBOX: sif, [`${agent.toUpperCase()}_HOME`]: config,
      CAPTURE: capture, CLI_EXIT: '19', COPILOT_GITHUB_TOKEN: 'test-token'};
    const launcher = `./agents/${agent}/launcher`;
    const result = run(launcher, [f.repo, '--model', 'model with spaces'], f, env);
    assert.equal(result.status, 19, result.stderr);
    const call = JSON.parse(readFileSync(capture));
    assert.deepEqual(call.args.slice(-2), ['--model', 'model with spaces']);
    assert.ok(call.args.includes(agent === 'codex' ? 'danger-full-access' : '--allow-all'));
    assert.ok(call.args.includes(`${f.repo}:/workspace`));
    assert.ok(call.args.includes('--cleanenv'));
    assert.equal(call.config, '{}');
    assert.equal(call.sqlite, false);
    assert.equal(existsSync(call.runtime), false);
    if (agent === 'copilot') {
      assert.equal(call.token, 'test-token');
      assert.ok(!call.args.includes('test-token'));
    }
    const missing = run(launcher, [], f, {...env, AGENT_SANDBOX: path.join(f.root, 'missing.sif')});
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /SIF image not found/);
  });
}
test('unknown agents fail before building', t => {
  const f = fixture(t);
  const result = run('make', ['build', 'AGENT=unknown'], f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown AGENT/);
});
