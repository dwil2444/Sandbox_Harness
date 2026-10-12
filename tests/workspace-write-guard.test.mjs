import assert from "node:assert/strict";
import test from "node:test";

import { evaluate } from "../agents/codex/policy/workspace-write-guard.mjs";

function run(tool_name, command, cwd = "/workspace") {
  return evaluate({ cwd, tool_name, tool_input: { command } }, "/workspace");
}

function denied(result) {
  return result.hookSpecificOutput?.permissionDecision === "deny";
}

test("allows direct writes inside the workspace", () => {
  assert.equal(denied(run("Bash", "mkdir -p build && touch build/result.txt")), false);
});

test("blocks direct writes outside the workspace", () => {
  assert.equal(denied(run("Bash", "touch /tmp/result.txt")), true);
  assert.equal(denied(run("Bash", "echo hello > /tmp/result.txt")), true);
  assert.equal(denied(run("Bash", "echo hello>/tmp/result.txt")), true);
  assert.equal(denied(run("Bash", "echo hello > '/tmp/result file.txt'")), true);
  assert.equal(denied(run("Bash", "cp input.txt /etc/result.txt")), true);
});

test("blocks dynamic write targets that cannot be verified", () => {
  assert.equal(denied(run("Bash", "touch $OUTPUT_FILE")), true);
});

test("blocks changing directory outside the workspace", () => {
  assert.equal(denied(run("Bash", "cd /tmp && touch result.txt")), true);
  assert.equal(denied(run("Bash", "sh -c 'cd /tmp && touch result.txt'")), true);
  assert.equal(denied(run("Bash", "cd src && touch result.txt")), false);
});

test("checks apply_patch paths", () => {
  assert.equal(denied(run("apply_patch", "*** Begin Patch\n*** Add File: src/new.txt\n+x\n*** End Patch")), false);
  assert.equal(denied(run("apply_patch", "*** Begin Patch\n*** Add File: ../new.txt\n+x\n*** End Patch")), true);
});
