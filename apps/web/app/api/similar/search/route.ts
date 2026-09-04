import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { assertWithinJobRateLimit } from "@/lib/rateLimit";
import { handleApiError } from "@/lib/apiErrors";

interface SimilarSearchBody {
  projectId: string;
  websiteIds: string[]; // сайты, для которых нажали "Искать схожее"
}

/** POST /api/similar/search — кнопка "Искать схожее" (п.4 ТЗ). */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUser(req);
    const body = (await req.json()) as SimilarSearchBody;
    if (!body.projectId || !body.websiteIds?.length) {
      return NextResponse.json({ error: "projectId и websiteIds обязательны" }, { status: 400 });
    }
    await assertOwnsProject(userId, body.projectId);
    await assertWithinJobRateLimit(userId);

    const now = Date.now();
    const jobRef = db().collection("jobs").doc();
    await jobRef.set({
      id: jobRef.id,
      userId,
      projectId: body.projectId,
      type: "FIND_SIMILAR",
      status: "QUEUED",
      progress: 0,
      total: 0,
      processed: 0,
      error: null,
      payload: { userId, projectId: body.projectId, sourceWebsiteIds: body.websiteIds },
      createdAt: now,
      startedAt: null,
      completedAt: null,
    });

    return NextResponse.json({ jobId: jobRef.id }, { status: 202 });
  } catch (err) {
    return handleApiError(err);
  }
}
