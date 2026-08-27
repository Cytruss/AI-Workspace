export type OnboardingMode = "guided" | "semi-automatic";

export type OnboardingStage =
  "complete" | "needs_operator_action" | "declined" | "cancelled" | "failed";

export interface OnboardingResult {
  stage: OnboardingStage;
  nextAction: string;
}
