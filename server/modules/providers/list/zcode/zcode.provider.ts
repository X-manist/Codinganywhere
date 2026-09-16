import { ZcodeProviderAuth } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import { ZcodeProviderModels } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { zcodeRuntime } from '@/modules/providers/list/zcode/zcode-runtime.provider.js';
import { ZcodeMcpProvider } from '@/modules/providers/list/zcode/zcode-mcp.provider.js';
import { ZcodeSessionSynchronizer } from '@/modules/providers/list/zcode/zcode-session-synchronizer.provider.js';
import { ZcodeSessionsProvider } from '@/modules/providers/list/zcode/zcode-sessions.provider.js';
import { ZcodeSkillsProvider } from '@/modules/providers/list/zcode/zcode-skills.provider.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderMcp,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSessions,
  IProviderSkills,
} from '@/shared/interfaces.js';

export class ZcodeProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = zcodeRuntime;
  readonly models: IProviderModels = new ZcodeProviderModels();
  readonly mcp: IProviderMcp = new ZcodeMcpProvider();
  readonly auth: IProviderAuth = new ZcodeProviderAuth();
  readonly skills: IProviderSkills = new ZcodeSkillsProvider();
  readonly sessions: IProviderSessions = new ZcodeSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new ZcodeSessionSynchronizer();

  constructor() {
    super('zcode');
  }
}
