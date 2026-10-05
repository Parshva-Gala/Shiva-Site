import type { MantineRadius, MantineSize } from "@mantine/core";
import { Avatar } from "@mantine/core";
import { IconPlugConnected } from "@tabler/icons-react";

import type { IntegrationKind } from "@homarr/definitions";
import { getIconUrl } from "@homarr/definitions";

interface IntegrationAvatarProps {
  size: MantineSize;
  kind: IntegrationKind | null;
  radius?: MantineRadius;
}

export const IntegrationAvatar = ({ kind, size, radius }: IntegrationAvatarProps) => {
  const url = kind ? getIconUrl(kind) : null;
  if (!url) {
    return null;
  }

  // Local SHIVA catalog decoration stays offline; explicit connector requests remain server-side.
  if (process.env.SHIVA_LOCAL_WEBSOCKET === "true") {
    return (
      <Avatar size={size} radius={radius}>
        <IconPlugConnected size="1.3333em" aria-hidden />
      </Avatar>
    );
  }

  return <Avatar size={size} src={url} radius={radius} styles={{ image: { objectFit: "contain" } }} />;
};
