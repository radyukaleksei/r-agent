import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { handleApiError } from "@/lib/apiErrors";

/** GET /api/network?projectId=... — полный граф связей проекта (для страницы "Граф"). */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUser(req);
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId обязателен" }, { status: 400 });
    await assertOwnsProject(userId, projectId);

    const projectRef = db().collection("users").doc(userId).collection("projects").doc(projectId);
    const [websitesSnap, relationshipsSnap] = await Promise.all([
      projectRef.collection("websites").where("status", "==", "ANALYZED").get(),
      projectRef.collection("relationships").get(),
    ]);

    return NextResponse.json({
      websites: websitesSnap.docs.map((d) => d.data()),
      relationships: relationshipsSnap.docs.map((d) => d.data()),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
