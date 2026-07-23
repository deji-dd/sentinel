import Image from "next/image";
import { LoginButton } from "@/components/login-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LegalSheet } from "@/components/legal-sheet";
import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();

  // Redirect to dashboard if already logged in
  if (session?.user) {
    redirect("/");
  }

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      {/* Left Panel: Branding & Atmosphere */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-zinc-50 dark:bg-zinc-950 p-10 text-zinc-900 dark:text-white lg:flex">
        {/* Background Atmosphere */}
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-linear-to-br from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-zinc-950" />
          <div className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full bg-blue-500/10 dark:bg-blue-600/20 blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] h-[500px] w-[500px] rounded-full bg-indigo-500/10 dark:bg-indigo-600/20 blur-[120px]" />

          {/* Subtle Grid overlay */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]" />
        </div>

        {/* Content Top */}
        <div className="relative z-10 flex items-center gap-3">
          <Image src="/logo.png" alt="Sentinel Logo" width={40} height={40} className="object-contain drop-shadow-sm dark:drop-shadow-md rounded-full" />
          <span className="text-xl font-semibold tracking-tight">Sentinel</span>
        </div>

        {/* Content Bottom */}
        <div className="relative z-10 space-y-6 max-w-lg">
          <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl xl:text-6xl/none bg-clip-text text-transparent bg-linear-to-br from-zinc-900 to-zinc-600 dark:from-white dark:to-white/60">
            Please
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            Don&apos;t break it!          </p>

          <div className="flex items-center gap-4 text-sm font-medium text-zinc-500">
            <div className="flex items-center gap-2">
              <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              Systems Operational
            </div>
            <div className="h-4 w-px bg-zinc-300 dark:bg-zinc-800" />
            <span>v2.0.0-beta</span>
          </div>
        </div>
      </div>

      {/* Right Panel: Auth Form */}
      <div className="relative flex flex-col justify-center p-8 sm:p-12 lg:p-16 xl:p-24 bg-background">
        {/* Theme Toggle in top right */}
        <div className="absolute right-4 top-4 md:right-8 md:top-8">
          <ThemeToggle />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-col gap-8">
          {/* Mobile Logo */}
          <div className="flex lg:hidden items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
              <Image src="/logo.png" alt="Sentinel Logo" width={24} height={24} className="object-contain" />
            </div>
            <span className="text-lg font-semibold tracking-tight">Sentinel</span>
          </div>

          <div className="flex flex-col space-y-2 text-center lg:text-left">
            <h2 className="text-3xl font-semibold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground">
              Sign in with your Discord account to access the Sentinel dashboard.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <form
              action={async () => {
                "use server";
                await signIn("discord");
              }}
            >
              <LoginButton />
            </form>
          </div>

          <p className="px-8 text-center text-sm text-muted-foreground lg:px-0 lg:text-left">
            By clicking continue, you agree to our{" "}
            <LegalSheet type="tos">Terms of Service</LegalSheet>
            {" "}and{" "}
            <LegalSheet type="privacy">Privacy Policy</LegalSheet>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
