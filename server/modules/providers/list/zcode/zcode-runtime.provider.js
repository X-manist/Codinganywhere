import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const activeZcodeProcesses = new Map();

/**
 * Locates the zcode CLI.
 *
 * zcode ships inside the ZCode desktop bundle as a Node script, so the usual
 * case spawns it with the server's own Node executable. `ZCODE_CLI_PATH`
 * overrides the script path (or points at a standalone `zcode` binary on
 * PATH), and a plain `zcode` on PATH is the last fallback.
 */
export function resolveZcodeCommand() {
  const override = process.env.ZCODE_CLI_PATH?.trim();
  if (override) {
    if (override.endsWith('.cjs') || override.endsWith('.js')) {
      return { command: process.execPath, baseArgs: [override], scriptPath: override };
    }
    return { command: override, baseArgs: [], scriptPath: override };
  }

  const platformCandidates = [
    '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
  ];
  for (const candidate of platformCandidates) {
    if (fsSync.existsSync(candidate)) {
      return { command: process.execPath, baseArgs: [candidate], scriptPath: candidate };
    }
  }

  return { command: 'zcode', baseArgs: [], scriptPath: null };
}

export function isZcodeInstalled() {
  const resolved = resolveZcodeCommand();
  if (resolved.command === process.execPath) {
    return fsSync.existsSync(resolved.scriptPath);
  }
  try {
    const result = spawnFunction.sync(resolved.command, [...resolved.baseArgs, '--version'], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Maps the UI permission mode onto zcode headless modes.
 *
 * zcode's `-p`/`--prompt` mode defaults to `yolo`; the explicit mapping keeps
 * plan/build selectable from the UI composer.
 */
export function resolveZcodePermissionOptions(permissionMode) {
  switch (permissionMode) {
    case 'plan':
      return { args: ['--mode', 'plan'], env: {} };
    case 'acceptEdits':
    case 'build':
      return { args: ['--mode', 'build'], env: {} };
    case 'bypassPermissions':
    case 'default':
    default:
      return { args: [], env: {} };
  }
}

function readZcodeSessionId(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  return typeof payload.sessionId === 'string' ? payload.sessionId : null;
}

/**
 * Extracts the terminal `--json` payload from buffered stdout.
 *
 * zcode prints progress to stderr and writes one JSON object at the end of
 * the run; tolerate leading log noise by scanning from the first `{`.
 */
function parseZcodeJsonOutput(stdoutText) {
  const trimmed = stdoutText.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to brace scanning
  }
  const start = trimmed.indexOf('{');
  if (start === -1) {
    return null;
  }
  try {
    return JSON.parse(trimmed.slice(start));
  } catch {
    return null;
  }
}

function buildTokenBudget(finalPayload) {
  const usage = finalPayload?.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  const inputTokens = Number(usage.inputTokens || 0) + Number(usage.cacheReadTokens || 0);
  const outputTokens = Number(usage.outputTokens || 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(usage.totalTokens || inputTokens + outputTokens),
    contextWindow: Number(finalPayload?.projection?.contextWindow || 0) || null,
  };
}

export function run(command, options, writer, context) {
  const {
    sessionId = null,
    projectPath = null,
    permissionMode = null,
    images = [],
    files = [],
  } = options || {};
  const ws = writer;
  const workingDir = projectPath || options?.cwd || process.cwd();
  const processKey = `zcode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    let zcodeProcess = null;
    let completeSent = false;
    let sessionCreatedSent = false;
    let terminalNotificationSent = false;
    let capturedSessionId = null;
    let providerSessionId = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const sessionSummary = typeof command === 'string' ? command.slice(0, 60) : null;

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) {
        return;
      }
      terminalNotificationSent = true;
      const finalSessionId = sessionId || capturedSessionId || processKey;
      const payload = {
        userId: ws?.userId || null,
        provider: 'zcode',
        sessionId: finalSessionId,
        sessionName: sessionSummary,
      };
      if (code === 0 && !error) {
        notifyRunStopped({ ...payload, stopReason: 'completed' });
        return;
      }
      notifyRunFailed({
        ...payload,
        error: error || `zcode CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId) => {
      if (!nextSessionId || capturedSessionId === nextSessionId) {
        return;
      }
      capturedSessionId = nextSessionId;
      if (!sessionId && zcodeProcess) {
        activeZcodeProcesses.delete(processKey);
        activeZcodeProcesses.set(capturedSessionId, zcodeProcess);
        zcodeProcess.sessionId = capturedSessionId;
      }
      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(capturedSessionId);
      }
      if (!providerSessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        ws.send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: capturedSessionId,
          sessionId: capturedSessionId,
          provider: 'zcode',
        }));
      }
    };

    try {
      providerSessionId = sessionId
        ? context.resolveProviderSessionId(sessionId)
        : null;
    } catch {
      providerSessionId = null;
    }

    void Promise.resolve(context.resolveResumeModel(sessionId, options?.model))
      .catch(() => undefined)
      .then(async (resolvedModel) => {
        const { command: spawnCommand, baseArgs } = resolveZcodeCommand();
        const permissionOptions = resolveZcodePermissionOptions(permissionMode);

        const promptText = command?.trim() || '';
        const args = [
          ...baseArgs,
          '-p', promptText,
          '--json',
          '--no-color',
          '--cwd', workingDir,
          ...permissionOptions.args,
        ];
        if (providerSessionId) {
          args.push('--resume', providerSessionId);
        }
        // zcode has no CLI model flag; the configured main provider/model in
        // ~/.zcode/cli/config.json governs. Keep resolvedModel reserved for a
        // future --model flag.
        void resolvedModel;

        zcodeProcess = spawnFunction(spawnCommand, args, {
          cwd: workingDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...permissionOptions.env },
        });

        activeZcodeProcesses.set(processKey, zcodeProcess);
        zcodeProcess.sessionId = processKey;
        zcodeProcess.stdin.end();

        zcodeProcess.stdout.on('data', (data) => {
          stdoutBuffer += data.toString();
        });

        zcodeProcess.stderr.on('data', (data) => {
          stderrBuffer += data.toString();
        });

        zcodeProcess.on('close', (code) => {
          const finalSessionId = sessionId || capturedSessionId || processKey;
          activeZcodeProcesses.delete(finalSessionId);
          activeZcodeProcesses.delete(processKey);

          const finalPayload = parseZcodeJsonOutput(stdoutBuffer);
          if (finalPayload) {
            registerSession(readZcodeSessionId(finalPayload));
          }
          const reportSessionId = capturedSessionId || sessionId || finalSessionId;

          const tokenBudget = buildTokenBudget(finalPayload);
          if (tokenBudget) {
            ws.send(createNormalizedMessage({
              kind: 'status',
              text: 'token_budget',
              tokenBudget,
              sessionId: reportSessionId,
              provider: 'zcode',
            }));
          }

          const responseText = typeof finalPayload?.response === 'string'
            ? finalPayload.response
            : null;
          if (responseText) {
            ws.send(createNormalizedMessage({
              kind: 'text',
              content: responseText,
              sessionId: reportSessionId,
              provider: 'zcode',
            }));
          } else if (code !== 0 || !finalPayload) {
            const stderrText = stderrBuffer.trim();
            const fallback = stderrText || `zcode CLI exited with code ${code}`;
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: fallback,
              sessionId: reportSessionId,
              provider: 'zcode',
            }));
          }

          if (!completeSent && !zcodeProcess.aborted) {
            completeSent = true;
            ws.send(createCompleteMessage({
              provider: 'zcode',
              sessionId: sessionId || null,
              actualSessionId: reportSessionId,
              exitCode: code,
            }));
          }

          if (code === 0) {
            notifyTerminalState({ code });
            resolve(finalPayload);
            return;
          }

          notifyTerminalState({ code });
          reject(new Error(
            stderrBuffer.trim() || `zcode CLI exited with code ${code}`
          ));
        });

        zcodeProcess.on('error', async (error) => {
          const finalSessionId = sessionId || capturedSessionId || processKey;
          activeZcodeProcesses.delete(finalSessionId);
          activeZcodeProcesses.delete(processKey);

          ws.send(createNormalizedMessage({
            kind: 'error',
            content: error.message,
            sessionId: finalSessionId,
            provider: 'zcode',
          }));
          if (!completeSent && !zcodeProcess.aborted) {
            completeSent = true;
            ws.send(createCompleteMessage({
              provider: 'zcode',
              sessionId: finalSessionId,
              exitCode: 1,
            }));
          }
          notifyTerminalState({ error });
          reject(error);
        });
      }).catch(reject);
  });
}

function abortZcodeSession(sessionId) {
  const proc = activeZcodeProcesses.get(sessionId);
  if (!proc) {
    return false;
  }
  proc.aborted = true;
  proc.kill('SIGTERM');
  activeZcodeProcesses.delete(sessionId);
  return true;
}

function isZcodeSessionActive(sessionId) {
  return activeZcodeProcesses.has(sessionId);
}

function getActiveZcodeSessions() {
  return [...activeZcodeProcesses.keys()];
}

export const zcodeRuntime = {
  run,
  abort: abortZcodeSession,
  isSessionActive: isZcodeSessionActive,
  getActiveSessions: getActiveZcodeSessions,
};

export default zcodeRuntime;
