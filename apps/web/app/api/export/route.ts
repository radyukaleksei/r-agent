import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { requireUser, assertOwnsProject } from "@/lib/auth";
import { handleApiError } from "@/lib/apiErrors";
import { buildReportRows, rowsToCsv, type WebsiteBundle } from "@site-network-agent/shared";
import type { Cluster, Relationship } from "@site-network-agent/types";

/**
 * GET /api/export?projectId=...&format=csv|json|xlsx&clusterId=optional
 * Отчёт по кластерам (п.15 ТЗ). Если clusterId передан — экспортируются
 * только сайты этого кластера, иначе — весь проект.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUser(req);
    const projectId = req.nextUrl.searchParams.get("projectId");
    const format = req.nextUrl.searchParams.get("format") ?? "json";
    const clusterId = req.nextUrl.searchParams.get("clusterId");
    if (!projectId) return NextResponse.json({ error: "projectId обязателен" }, { status: 400 });
    if (!["csv", "json", "xlsx"].includes(format)) {
      return NextResponse.json({ error: "format должен быть csv|json|xlsx" }, { status: 400 });
    }
    await assertOwnsProject(userId, projectId);

    const projectRef = db().collection("users").doc(userId).collection("projects").doc(projectId);

    const [websitesSnap, relationshipsSnap, clustersSnap] = await Promise.all([
      projectRef.collection("websites").get(),
      projectRef.collection("relationships").get(),
      projectRef.collection("clusters").get(),
    ]);

    let websiteDocs = websitesSnap.docs;
    if (clusterId) {
      const clusterDoc = clustersSnap.docs.find((d) => d.id === clusterId);
      const memberIds = new Set((clusterDoc?.data().websiteIds as string[]) ?? []);
      websiteDocs = websiteDocs.filter((d) => memberIds.has(d.id));
    }

    const bundles: WebsiteBundle[] = await Promise.all(
      websiteDocs.map(async (doc) => {
        const [gtm, tracking, scripts, external, endpoints] = await Promise.all([
          doc.ref.collection("gtmContainers").get(),
          doc.ref.collection("trackingIdentifiers").get(),
          doc.ref.collection("scripts").get(),
          doc.ref.collection("externalResources").get(),
          doc.ref.collection("endpoints").get(),
        ]);
        return {
          website: doc.data() as WebsiteBundle["website"],
          gtmContainers: gtm.docs.map((d) => d.data()) as WebsiteBundle["gtmContainers"],
          trackingIdentifiers: tracking.docs.map((d) => d.data()) as WebsiteBundle["trackingIdentifiers"],
          scripts: scripts.docs.map((d) => d.data()) as WebsiteBundle["scripts"],
          externalResources: external.docs.map((d) => d.data()) as WebsiteBundle["externalResources"],
          endpoints: endpoints.docs.map((d) => d.data()) as WebsiteBundle["endpoints"],
        };
      })
    );

    const relationships = relationshipsSnap.docs.map((d) => d.data() as Relationship);
    const clusters = clustersSnap.docs.map((d) => d.data() as Cluster);
    const rows = buildReportRows(bundles, relationships, clusters);

    if (format === "json") {
      return NextResponse.json({ rows, clusters, relationships });
    }

    if (format === "csv") {
      const csv = rowsToCsv(rows);
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="report-${projectId}.csv"`,
        },
      });
    }

    // xlsx — динамический импорт, чтобы не тянуть exceljs в бандл для csv/json путей
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Report");
    sheet.columns = [
      { header: "Website", key: "website", width: 30 },
      { header: "GTM IDs", key: "gtmIds", width: 20 },
      { header: "External domains", key: "externalDomains", width: 30 },
      { header: "Tracking IDs", key: "trackingIds", width: 25 },
      { header: "Scripts", key: "scripts", width: 30 },
      { header: "Endpoints", key: "endpoints", width: 30 },
      { header: "Related websites", key: "relatedWebsites", width: 20 },
      { header: "Similarity score", key: "similarityScore", width: 15 },
      { header: "Cluster", key: "cluster", width: 20 },
      { header: "Evidence", key: "evidence", width: 40 },
    ];
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="report-${projectId}.xlsx"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
