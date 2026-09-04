import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { assertWithinJobRateLimit } from "@/lib/rateLimit";
import { handleApiError } from "@/lib/apiErrors";
import type { Device } from "@site-network-agent/types";

interface SearchRequestBody {
  projectId: string;
  keywords: string;
  country: string;
  language: string;
  device: Device;
  extraParams?: Record<string, string>;
}

/**
 * Создаёт Search + AnalysisJob(type=SEARCH_GOOGLE, status=QUEUED).
 * Сам запрос к Google выполняет browser-worker (см. jobs/handlers/searchGoogle.ts) —
 * этот route НЕ делает долгий scraping внутри HTTP-запроса (см. п. "Vercel"
 * исходного ТЗ по инфраструктуре: "не выполняй длинный массовый scraping
 * непосредственно в HTTP request").
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUser(req);
    const body = (await req.json()) as SearchRequestBody;

    if (!body.projectId || !body.keywords?.trim()) {
      return NextResponse.json({ error: "projectId и keywords обязательны" }, { status: 400 });
    }
    await assertOwnsProject(userId, body.projectId);
    await assertWithinJobRateLimit(userId);

    const now = Date.now();
    const projectRef = db()
      .collection("users")
      .doc(userId)
      .collection("projects")
      .doc(body.projectId);

    const searchRef = projectRef.collection("searches").doc();
    await searchRef.set({
      id: searchRef.id,
      projectId: body.projectId,
      keywords: body.keywords.trim(),
      country: body.country,
      language: body.language,
      device: body.device,
      extraParams: body.extraParams ?? {},
      createdAt: now,
    });

    const jobRef = db().collection("jobs").doc();
    await jobRef.set({
      id: jobRef.id,
      userId,
      projectId: body.projectId,
      type: "SEARCH_GOOGLE",
      status: "QUEUED",
      progress: 0,
      total: 0,
      processed: 0,
      error: null,
      payload: {
        userId,
        projectId: body.projectId,
        searchId: searchRef.id,
        keywords: body.keywords.trim(),
        country: body.country,
        language: body.language,
        device: body.device,
      },
      createdAt: now,
      startedAt: null,
      completedAt: null,
    });

    return NextResponse.json({ searchId: searchRef.id, jobId: jobRef.id }, { status: 202 });
  } catch (err) {
    return handleApiError(err);
  }
}
