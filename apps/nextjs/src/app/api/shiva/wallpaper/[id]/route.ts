import { NextResponse } from "next/server";

import { auth } from "@homarr/auth/next";
import { createLogger } from "@homarr/core/infrastructure/logs";

import { assertWallpaperSameOrigin, deleteWallpaper, readWallpaper, WallpaperError } from "~/shiva/server/wallpaper";

export const runtime = "nodejs";
const logger = createLogger({ module: "shivaWallpaperAsset" });
const noStore = { "Cache-Control": "no-store" };
type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  if (error instanceof WallpaperError)
    return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
  logger.error("Wallpaper asset request failed", { errorType: error instanceof Error ? error.name : "unknown" });
  return NextResponse.json(
    { error: "Wallpaper storage is unavailable. Try again shortly." },
    { status: 503, headers: noStore },
  );
}

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user.id)
    return NextResponse.json({ error: "Sign in to view this wallpaper." }, { status: 401, headers: noStore });
  try {
    const { id } = await context.params;
    const thumbnail = new URL(request.url).searchParams.get("thumbnail") === "1";
    const bytes = await readWallpaper(session.user.id, id, thumbnail);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": bytes.byteLength.toString(),
        "Cache-Control": "private, max-age=31536000, immutable",
        Vary: "Cookie",
        ETag: `"${id}${thumbnail ? "-thumbnail" : ""}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user.id)
    return NextResponse.json({ error: "Sign in to manage wallpapers." }, { status: 401, headers: noStore });
  try {
    assertWallpaperSameOrigin(request);
    const { id } = await context.params;
    return NextResponse.json(await deleteWallpaper(session.user.id, id), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
