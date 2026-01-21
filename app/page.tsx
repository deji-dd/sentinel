import { LoginCard } from "@/components/auth/login-card";
import { Toaster } from "sonner";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <main className="flex min-h-screen w-full flex-col items-center justify-center px-4 py-8">
        <LoginCard />
      </main>
      <Toaster position="bottom-center" theme="dark" />
    </div>
  );
}
