import { NextResponse } from "next/server";

import { auth } from "@homarr/auth/next";
import { createLogger } from "@homarr/core/infrastructure/logs";

import {
  assertWallpaperSameOrigin,
  listWallpapers,
  readWallpaperForm,
  saveWallpaper,
  WallpaperError,
} from "~/shiva/server/wallpaper";

export const runtime = "nodejs";
const logger = createLogger({ module: "shivaWallpaper" });
const noStore = { "Cache-Control": "no-store" };

function errorResponse(error: unknown) {
  if (error instanceof WallpaperError)
    return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
  logger.error("Wallpaper request failed", { errorType: error instanceof Error ? error.name : "unknown" });
  return NextResponse.json(
    { error: "Wallpaper storage is unavailable. Try again or check the local data directory." },
    { status: 503, headers: noStore },
  );
}

export async function GET() {
  const session = await auth();
  if (!session?.user.id)
    return NextResponse.json({ error: "Sign in to access wallpapers." }, { status: 401, headers: noStore });
  try {
    return NextResponse.json({ assets: await listWallpapers(session.user.id) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user.id)
    return NextResponse.json({ error: "Sign in to upload a wallpaper." }, { status: 401, headers: noStore });
  try {
    assertWallpaperSameOrigin(request);
    const file = await readWallpaperForm(request);
    return NextResponse.json(await saveWallpaper(session.user.id, file), { status: 201, headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
