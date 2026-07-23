"use client";

import dynamic from "next/dynamic";

export const TTSelector = dynamic(
  () => import("./painter").then((mod) => mod.TTSelector),
  { ssr: false }
);
