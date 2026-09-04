import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { handleApiError } from "@/lib/apiErrors";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUser(req);
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId обязателен" }, { status: 400 });
    await assertOwnsProject(userId, projectId);

    const projectRef = db().collection("users").doc(userId).collection("projects").doc(projectId);
    const clusterSnap = await projectRef.collection("clusters").doc(params.id).get();
    if (!clusterSnap.exists) return NextResponse.json({ error: "Кластер не найден" }, { status: 404 });

    const cluster = clusterSnap.data()!;
    const websiteIds: string[] = cluster.websiteIds ?? [];

    const [websiteDocs, relationshipsSnap] = await Promise.all([
      Promise.all(websiteIds.map((id) => projectRef.collection("websites").doc(id).get())),
      projectRef.collection("relationships").get(),
    ]);

    const memberSet = new Set(websiteIds);
    const internalRelationships = relationshipsSnap.docs
      .map((d) => d.data())
      .filter((r) => memberSet.has(r.sourceWebsiteId) && memberSet.has(r.targetWebsiteId));

    return NextResponse.json({
      cluster,
      websites: websiteDocs.filter((d) => d.exists).map((d) => d.data()),
      relationships: internalRelationships,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
