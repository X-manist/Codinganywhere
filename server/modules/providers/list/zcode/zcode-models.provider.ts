import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/**
 * Curated zcode catalog shipped as immutable CloudCLI defaults.
 *
 * zcode routes by `providerId/modelId` against the providers configured in
 * `~/.zcode/cli/config.json`; these mirror the BigModel coding-plan entries
 * that ship with the ZCode desktop app. The CLI itself has no --model flag,
 * so the runtime uses the configured main model unless the user switches it
 * inside zcode.
 */
export const ZCODE_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'builtin:bigmodel-coding-plan/GLM-5.3-Flash',
      label: 'GLM 5.3 Flash',
      description: 'BigModel Coding Plan',
    },
    {
      value: 'builtin:bigmodel-coding-plan/GLM-5.3',
      label: 'GLM 5.3',
      description: 'BigModel Coding Plan',
    },
  ],
  DEFAULT: 'builtin:bigmodel-coding-plan/GLM-5.3-Flash',
};

export class ZcodeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return ZCODE_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(ZCODE_PREDEFINED_MODELS);
  }
}
