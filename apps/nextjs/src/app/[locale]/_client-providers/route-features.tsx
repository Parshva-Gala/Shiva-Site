// SHIVA extension, Apache-2.0. Native modules keep shared identity, queries, and theme providers.
"use client";

import type { PropsWithChildren } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

import type { AssistantAvailability } from "~/components/assistant/assistant-gate";
import { isShivaRoute } from "./native-route";

const HostFeatureProviders = dynamic(() => import("./host-features").then((module) => module.HostFeatureProviders));

export const RouteFeatureProviders = ({
  children,
  availability,
}: PropsWithChildren<{ availability: AssistantAvailability }>) => {
  const pathname = usePathname();
  // SHIVA uses its own scoped Mantine dialogs. Legacy search, board modals, and assistant
  // features remain available on every host route without entering the native cold-start graph.
  if (isShivaRoute(pathname)) return children;
  return <HostFeatureProviders availability={availability}>{children}</HostFeatureProviders>;
};
