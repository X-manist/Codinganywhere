/**
 * Manual end-to-end check for the zcode provider adapter.
 *
 * Drives the real zcode CLI twice through the same runtime the server uses:
 *   1. a fresh headless prompt  (verifies spawn + --json parsing + complete)
 *   2. a resumed session        (verifies --resume <sess_...> context carry)
 *
 * Run with:  npx tsx --tsconfig server/tsconfig.json scripts/zcode-adapter-e2e.ts
 */
import assert from 'node:assert/strict';

import { zcodeRuntime } from '@/modules/providers/list/zcode/zcode-runtime.provider.js';
import { ZcodeSessionsProvider } from '@/modules/providers/list/zcode/zcode-sessions.provider.js';

type Msg = { kind: string; sessionId?: string | null; newSessionId?: string; content?: string };

function createContext(resolvedSessionId: string | null) {
  const sessions = new ZcodeSessionsProvider();
  return {
    resolveProviderSessionId: (_sessionId: string | null | undefined) => resolvedSessionId,
    resolveResumeModel: async (_sessionId: string | undefined, _model?: string | null) => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: (raw: unknown, sessionId: string | null) => sessions.normalizeMessage(raw, sessionId),
    async isProviderInstalled() {
      return true;
    },
  };
}

async function runOnce(opts: {
  prompt: string;
  sessionId: string | null;
  resolvedProviderSessionId: string | null;
}): Promise<{ messages: Msg[]; providerSessionId: string | null }> {
  const messages: Msg[] = [];
  let providerSessionId: string | null = null;
  const writer = {
    send: (data: unknown) => {
      const msg = data as Msg;
      messages.push(msg);
      if (msg.kind === 'session_created' && msg.newSessionId) {
        providerSessionId = msg.newSessionId;
      }
      console.log(`  [writer] ${msg.kind}${msg.content ? `: ${String(msg.content).slice(0, 80)}` : ''}`);
    },
    setSessionId: (id: string) => {
      console.log(`  [writer] setSessionId(${id})`);
    },
  };

  await zcodeRuntime.run(
    opts.prompt,
    { projectPath: '/tmp/zcode-headless-test', sessionId: opts.sessionId, permissionMode: 'plan' },
    writer as never,
    createContext(opts.resolvedProviderSessionId) as never,
  );
  return { messages, providerSessionId };
}

async function main() {
  const workDirSetup = true;
  void workDirSetup;

  console.log('--- run 1: fresh headless prompt ---');
  const first = await runOnce({
    prompt: '记住这个暗号:菠萝披萨。只回复:已记住',
    sessionId: null,
    resolvedProviderSessionId: null,
  });

  const complete1 = first.messages.find((m) => m.kind === 'complete');
  assert.ok(complete1, 'run 1 must end with a complete message');
  assert.ok(first.providerSessionId?.startsWith('sess_'), `run 1 must capture a sess_ id, got ${first.providerSessionId}`);
  console.log(`--- run 1 ok: providerSessionId=${first.providerSessionId}`);

  console.log('--- run 2: resume the same session ---');
  const second = await runOnce({
    prompt: '我让你记住的暗号是什么?只回复暗号本身',
    sessionId: first.providerSessionId,
    resolvedProviderSessionId: first.providerSessionId,
  });

  const text2 = second.messages
    .filter((m) => m.kind === 'text')
    .map((m) => m.content ?? '')
    .join('\n');
  assert.ok(
    text2.includes('菠萝披萨'),
    `run 2 should recall the passphrase via --resume, got: ${text2}`,
  );
  const complete2 = second.messages.find((m) => m.kind === 'complete');
  assert.ok(complete2, 'run 2 must end with a complete message');
  console.log(`--- run 2 ok: recalled "${text2.trim().slice(0, 40)}"`);

  console.log('\n✅ zcode adapter e2e passed (fresh run + resume)');
}

main().catch((error) => {
  console.error('\n❌ zcode adapter e2e failed:', error);
  process.exit(1);
});
