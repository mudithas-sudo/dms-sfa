import OnboardingQueue from "@/components/admin/OnboardingQueue";

export default async function OutletOnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  return <OnboardingQueue back="/admin/outlets/onboarding" error={error} notice={notice} />;
}
