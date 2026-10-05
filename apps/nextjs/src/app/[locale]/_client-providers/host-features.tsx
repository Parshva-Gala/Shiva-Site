"use client";

import type { PropsWithChildren } from "react";
import { ModalProvider } from "@homarr/modals";
import { SpotlightProvider } from "@homarr/spotlight";

import { AssistantGate } from "~/components/assistant/assistant-gate";
import type { AssistantAvailability } from "~/components/assistant/assistant-gate";

// Preserve Homarr's provider order for boards, administration, authentication, and onboarding.
export const HostFeatureProviders = ({
  children,
  availability,
}: PropsWithChildren<{ availability: AssistantAvailability }>) => (
  <ModalProvider>
    <SpotlightProvider>
      <AssistantGate availability={availability}>{children}</AssistantGate>
    </SpotlightProvider>
  </ModalProvider>
);
