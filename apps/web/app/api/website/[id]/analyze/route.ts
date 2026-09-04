import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { assertWithinJobRateLimit } from "@/lib/rateLimit";
import { handleApiError } from "@/lib/apiErrors";
import type { Device } from "@site-network-agent/types";

interface AnalyzeRequestBody {
  projectId: string;
  device: Device;
  country: string;
  language: string;
}

/**
 * POST /api/website/:id/analyze — анализ ОДНОГО сайта (кнопка "Анализ" в таблице).
 * Для массового выбора нескольких сайтов используется тот же паттерн, но
 * job type=ANALYZE_BATCH с payload.websiteIds — см. handler
 * services/browser-worker/src/jobs/handlers/analyzeBatch.ts. Отдельный route
 * для batch не приводится здесь, т.к. повторяет структуру этого файла
 * (валидация → assertOwnsProject → rate limit → создание job).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUser(req);
    const body = (await req.json()) as AnalyzeRequestBody;
    if (!body.projectId) return NextResponse.json({ error: "projectId обязателен" }, { status: 400 });

    await assertOwnsProject(userId, body.projectId);
    await assertWithinJobRateLimit(userId);

    const websiteRef = db()
      .collection("users")
      .doc(userId)
      .collection("projects")
      .doc(body.projectId)
      .collection("websites")
      .doc(params.id);

    const websiteSnap = await websiteRef.get();
    if (!websiteSnap.exists) {
      return NextResponse.json({ error: "Сайт не найден в проекте" }, { status: 404 });
    }

    const now = Date.now();
    const jobRef = db().collection("jobs").doc();
    await jobRef.set({
      id: jobRef.id,
      userId,
      projectId: body.projectId,
      type: "ANALYZE_WEBSITE",
      status: "QUEUED",
      progress: 0,
      total: 1,
      processed: 0,
      error: null,
      payload: {
        userId,
        projectId: body.projectId,
        websiteId: params.id,
        url: websiteSnap.data()!.url,
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
