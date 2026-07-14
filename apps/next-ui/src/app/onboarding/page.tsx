import { redirect } from "next/navigation";
import { OnboardingForm } from "./OnboardingForm";

export default async function OnboardingPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
  let shouldRedirect = false;

  try {
    const res = await fetch(`${apiUrl}/api/config`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data.configured) {
        shouldRedirect = true;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    // API might be down, allow to see onboarding anyway
  }

  if (shouldRedirect) {
    redirect("/");
  }

  return (
    <main className="w-full max-w-2xl mx-auto space-y-16 flex flex-col items-center mt-12 md:mt-24">
      <div className="flex flex-col items-center space-y-3 text-center">
        <h1 className="text-xs font-medium uppercase tracking-[0.4em] text-neutral-400">Sentinel System</h1>
        <p className="text-[10px] text-neutral-600 font-mono tracking-widest">AWAITING_INITIALIZATION_SEQUENCE</p>
      </div>
      <OnboardingForm />
    </main>
  );
}
