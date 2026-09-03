#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function denial(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function workspaceArgument(argv) {
  const index = argv.indexOf("--workspace");
  if (index === -1 || !argv[index + 1]) return null;
  return path.resolve(argv[index + 1]);
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function targetPath(raw, cwd) {
  if (!raw || raw === "-") return null;
  if (/[`$*?{}[\]]/.test(raw)) return { dynamic: true, raw };
  const expanded = raw.startsWith("~/")
    ? path.join(process.env.HOME ?? "/home/codex", raw.slice(2))
    : raw;
  return { dynamic: false, raw, absolute: path.resolve(cwd, expanded) };
}

function validateTarget(raw, cwd, workspace) {
  const target = targetPath(raw, cwd);
  if (!target) return null;
  if (target.dynamic) return `Cannot verify dynamic write target: ${target.raw}`;
  if (!inside(workspace, target.absolute)) {
    return `Write target is outside ${workspace}: ${target.absolute}`;
  }
  return null;
}

// This intentionally handles the common direct-write forms. It is a policy
// guardrail; the Apptainer mount namespace remains the security boundary.
function shellWords(command) {
  const words = [];
  let word = "";
  let quote = null;
  let escaped = false;

  const push = () => {
    if (word) words.push(word);
    word = "";
  };

  for (const char of command) {
    if (escaped) {
      word += char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      push();
    } else if (";|&".includes(char)) {
      push();
      words.push(";");
    } else {
      word += char;
    }
  }
  push();
  return words;
}

function commandSegments(command) {
  return shellWords(command).reduce((segments, word) => {
    if (word === ";") segments.push([]);
    else segments.at(-1).push(word);
    return segments;
  }, [[]]).filter((segment) => segment.length);
}

function operands(words) {
  return words.filter((word) => !word.startsWith("-"));
}

function bashViolation(command, cwd, workspace) {
  const redirectPattern = /(?:\d*>>?|&>)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  for (const match of command.matchAll(redirectPattern)) {
    const violation = validateTarget(match[1] ?? match[2] ?? match[3], cwd, workspace);
    if (violation) return violation;
  }

  const everyOperandIsTarget = new Set([
    "chmod", "chown", "chgrp", "mkdir", "mkfifo", "mknod", "rm", "rmdir",
    "touch", "truncate", "unlink",
  ]);
  const finalOperandIsTarget = new Set(["cp", "install", "ln", "mv", "rsync"]);

  for (const segment of commandSegments(command)) {
    while (segment[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[0])) segment.shift();
    const executable = path.basename(segment[0] ?? "");
    const args = segment.slice(1);
    let targets = [];

    if (executable === "cd" || executable === "pushd") {
      const destination = operands(args).at(-1) ?? "~/";
      const violation = validateTarget(destination, cwd, workspace);
      if (violation) return `Working directory would leave the workspace. ${violation}`;
    } else if (["bash", "dash", "sh", "zsh"].includes(executable)) {
      const commandIndex = args.indexOf("-c");
      if (commandIndex !== -1 && args[commandIndex + 1]) {
        const violation = bashViolation(args[commandIndex + 1], cwd, workspace);
        if (violation) return violation;
      }
    } else if (everyOperandIsTarget.has(executable)) {
      targets = operands(args);
    } else if (finalOperandIsTarget.has(executable)) {
      const values = operands(args);
      targets = values.length ? [values.at(-1)] : [];
      const targetDirectoryIndex = args.findIndex((arg) => arg === "-t" || arg === "--target-directory");
      if (targetDirectoryIndex !== -1 && args[targetDirectoryIndex + 1]) {
        targets = [args[targetDirectoryIndex + 1]];
      }
    } else if (executable === "tee") {
      targets = operands(args);
    } else if (executable === "dd") {
      targets = args.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3));
    }

    for (const target of targets) {
      const violation = validateTarget(target, cwd, workspace);
      if (violation) return violation;
    }
  }
  return null;
}

function patchViolation(patch, cwd, workspace) {
  const headerPattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm;
  const headers = [...patch.matchAll(headerPattern)];
  if (!headers.length) return "Cannot verify apply_patch input without file headers";
  for (const match of headers) {
    const violation = validateTarget((match[1] ?? match[2]).trim(), cwd, workspace);
    if (violation) return violation;
  }
  return null;
}

export function evaluate(event, workspacePath) {
  const workspace = path.resolve(workspacePath);
  const cwd = path.resolve(event.cwd ?? workspace);
  const command = event.tool_input?.command;
  if (typeof command !== "string") return denial("Workspace write guard received no command");

  const violation = event.tool_name === "Bash"
    ? bashViolation(command, cwd, workspace)
    : event.tool_name === "apply_patch"
      ? patchViolation(command, cwd, workspace)
      : `Unexpected tool matched workspace write guard: ${event.tool_name}`;

  return violation ? denial(violation) : {};
}

function main() {
  const workspace = workspaceArgument(process.argv.slice(2));
  if (!workspace) {
    process.stdout.write(JSON.stringify(denial("Workspace write guard is missing its --workspace setting")));
    return;
  }

  try {
    const event = JSON.parse(fs.readFileSync(0, "utf8"));
    process.stdout.write(JSON.stringify(evaluate(event, workspace)));
  } catch {
    process.stdout.write(JSON.stringify(denial("Workspace write guard received invalid hook input")));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
