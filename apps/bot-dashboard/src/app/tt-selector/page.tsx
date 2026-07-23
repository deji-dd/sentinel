import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getUserMaps, getTerritoryMetadata } from "@/actions/tt-selector";
import { TTSelector } from "@/components/tt-selector/client-wrapper";

export default async function TTSelectorPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const userMaps = await getUserMaps();
  const metadata = await getTerritoryMetadata();

  return (
    <div className="w-full h-screen overflow-hidden flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white">
      <TTSelector initialMaps={userMaps} metadata={metadata} />
    </div>
  );
}
