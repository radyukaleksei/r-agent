import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { handleApiError } from "@/lib/apiErrors";

/**
 * GET /api/website/:id/analysis?projectId=...
 * Возвращает Website + все связанные подколлекции одним ответом —
 * то, что рендерит "подробную карточку сайта" (п.12 ТЗ).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUser(req);
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId обязателен" }, { status: 400 });
    await assertOwnsProject(userId, projectId);

    const websiteRef = db()
      .collection("users")
      .doc(userId)
      .collection("projects")
      .doc(projectId)
      .collection("websites")
      .doc(params.id);

    const [website, gtm, tracking, scripts, external, endpoints, fingerprint] = await Promise.all([
      websiteRef.get(),
      websiteRef.collection("gtmContainers").get(),
      websiteRef.collection("trackingIdentifiers").get(),
      websiteRef.collection("scripts").get(),
      websiteRef.collection("externalResources").get(),
      websiteRef.collection("endpoints").get(),
      websiteRef.collection("fingerprint").doc("current").get(),
    ]);

    if (!website.exists) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

    return NextResponse.json({
      website: website.data(),
      gtmContainers: gtm.docs.map((d) => d.data()),
      trackingIdentifiers: tracking.docs.map((d) => d.data()),
      scripts: scripts.docs.map((d) => d.data()),
      externalResources: external.docs.map((d) => d.data()),
      endpoints: endpoints.docs.map((d) => d.data()),
      fingerprint: fingerprint.exists ? fingerprint.data() : null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
