import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { handleApiError } from "@/lib/apiErrors";

/** GET /api/search/:id?projectId=... — статус поиска (используется для polling прогресса). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUser(req);
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId обязателен" }, { status: 400 });
    await assertOwnsProject(userId, projectId);

    const snap = await db()
      .collection("users")
      .doc(userId)
      .collection("projects")
      .doc(projectId)
      .collection("searches")
      .doc(params.id)
      .get();

    if (!snap.exists) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    return NextResponse.json(snap.data());
  } catch (err) {
    return handleApiError(err);
  }
}
