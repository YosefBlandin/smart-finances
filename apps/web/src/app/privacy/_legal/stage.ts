import { getContainer } from '@/adapters/container';

// The two stage settings the public pages show (architecture.md "Web server settings"): the support address
// (SUPPORT_ADDRESS, D-103) and whether this is a test stage whose data may be wiped (qa, and test locally; D-118).
export function publicStage(): { supportAddress: string; testStage: boolean } {
  const { STAGE, SUPPORT_ADDRESS } = getContainer().settings.get();
  return { supportAddress: SUPPORT_ADDRESS, testStage: STAGE === 'qa' || STAGE === 'test' };
}
