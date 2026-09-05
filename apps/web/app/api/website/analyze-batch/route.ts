import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { assertWithinJobRateLimit } from "@/lib/rateLimit";
import { handleApiError } from "@/lib/apiErrors";
import type { Device } from "@site-network-agent/types";

interface AnalyzeBatchRequestBody {
  projectId: string;
  websiteIds: string[];
  device: Device;
  country: string;
  language: string;
}

/**
 * POST /api/website/analyze-batch — кнопка "Анализировать выбранное".
 * Создаёт ОДНУ задачу типа ANALYZE_BATCH на все выбранные сайты сразу
 * (обработчик — services/browser-worker/src/jobs/handlers/analyzeBatch.ts),
 * а не по отдельной задаче на каждый сайт — иначе выбор даже 3 сайтов
 * упирается в лимит одновременных задач на пользователя.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUser(req);
    const body = (await req.json()) as AnalyzeBatchRequestBody;

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
      type: "ANALYZE_BATCH",
      status: "QUEUED",
      progress: 0,
      total: body.websiteIds.length,
      processed: 0,
      error: null,
      payload: {
        userId,
        projectId: body.projectId,
        websiteIds: body.websiteIds,
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
