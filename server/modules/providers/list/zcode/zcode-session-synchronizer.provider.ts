import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

/**
 * zcode keeps sessions in its own internal store (resumable via `--resume
 * sess_...`), which has no on-disk transcript CloudCLI can index today. The
 * synchronizer stays a no-op until the zcode app-server transcript reader is
 * wired in.
 */
export class ZcodeSessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(_since?: Date): Promise<number> {
    return 0;
  }

  async synchronizeFile(_filePath: string): Promise<string | null> {
    return null;
  }
}
