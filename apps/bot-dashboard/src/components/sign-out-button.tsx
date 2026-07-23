"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "./ui/button";

export function SignOutButton() {
  return (
    <Button 
      variant="ghost" 
      size="icon" 
      onClick={() => signOut()}
      title="Sign Out"
    >
      <LogOut className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
      <span className="sr-only">Sign out</span>
    </Button>
  );
}
