import OnboardingQueue from "@/components/admin/OnboardingQueue";

export default async function SupervisorOnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  return <OnboardingQueue back="/supervisor/onboarding" error={error} notice={notice} />;
}
