import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { assertWithinJobRateLimit } from "@/lib/rateLimit";
import { handleApiError } from "@/lib/apiErrors";
import type { Device } from "@site-network-agent/types";

interface ExpandNetworkBody {
  projectId: string;
  websiteIds: string[];
  depth: 1 | 2 | 3; // ограничение объёма исследования, см. п.8 ТЗ
  device: Device;
  country: string;
  language: string;
}

const MAX_DEPTH = 3;

/** POST /api/network/expand — кнопка "Расширить сеть". */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUser(req);
    const body = (await req.json()) as ExpandNetworkBody;
    if (!body.projectId || !body.websiteIds?.length) {
      return NextResponse.json({ error: "projectId и websiteIds обязательны" }, { status: 400 });
    }
    if (body.depth < 1 || body.depth > MAX_DEPTH) {
      return NextResponse.json({ error: `depth должен быть от 1 до ${MAX_DEPTH}` }, { status: 400 });
    }
    await assertOwnsProject(userId, body.projectId);
    await assertWithinJobRateLimit(userId);

    const now = Date.now();
    const jobRef = db().collection("jobs").doc();
    await jobRef.set({
      id: jobRef.id,
      userId,
      projectId: body.projectId,
      type: "EXPAND_NETWORK",
      status: "QUEUED",
      progress: 0,
      total: 0,
      processed: 0,
      error: null,
      depth: body.depth,
      payload: {
        userId,
        projectId: body.projectId,
        sourceWebsiteIds: body.websiteIds,
        depth: body.depth,
        device: body.device,
        country: body.country,
        language: body.language,
      },
      createdAt: now,
      startedAt: null,
      completedAt: null,
    });

    return NextResponse.json({ jobId: jobRef.id }, { status: 202 });
  } catch (err) {
    return handleApiError(err);
  }
}
