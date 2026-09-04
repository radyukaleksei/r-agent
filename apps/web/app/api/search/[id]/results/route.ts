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

    const snap = await db()
      .collection("users")
      .doc(userId)
      .collection("projects")
      .doc(projectId)
      .collection("searches")
      .doc(params.id)
      .collection("results")
      .orderBy("position", "asc")
      .get();

    return NextResponse.json({ results: snap.docs.map((d) => d.data()) });
  } catch (err) {
    return handleApiError(err);
  }
}
