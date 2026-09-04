import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { handleApiError } from "@/lib/apiErrors";
import type { Relationship } from "@site-network-agent/types";

/**
 * GET /api/network/:id?projectId=...
 * :id — websiteId. Возвращает все Relationship, где сайт — source ИЛИ target,
 * плюс сами связанные сайты — минимальный набор данных, чтобы отрисовать
 * граф связей вокруг одного узла (п.5 ТЗ).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUser(req);
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId обязателен" }, { status: 400 });
    await assertOwnsProject(userId, projectId);

    const projectRef = db().collection("users").doc(userId).collection("projects").doc(projectId);

    const [asSource, asTarget] = await Promise.all([
      projectRef.collection("relationships").where("sourceWebsiteId", "==", params.id).get(),
      projectRef.collection("relationships").where("targetWebsiteId", "==", params.id).get(),
    ]);

    const relationships: Relationship[] = [
      ...asSource.docs.map((d) => d.data() as Relationship),
      ...asTarget.docs.map((d) => d.data() as Relationship),
    ];

    const neighborIds = new Set<string>();
    for (const rel of relationships) {
      neighborIds.add(rel.sourceWebsiteId === params.id ? rel.targetWebsiteId : rel.sourceWebsiteId);
    }

    const neighborDocs = await Promise.all(
      Array.from(neighborIds).map((id) => projectRef.collection("websites").doc(id).get())
    );

    return NextResponse.json({
      relationships,
      neighbors: neighborDocs.filter((d) => d.exists).map((d) => d.data()),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
