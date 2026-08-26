import type { AppPaths } from "../config/app-paths.js";
import type { OnboardingResult } from "./onboarding-types.js";

export async function runOnboarding(
  _paths: AppPaths,
): Promise<OnboardingResult> {
  throw new Error("Onboarding is not implemented yet");
}
