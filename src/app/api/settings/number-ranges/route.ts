import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { listNumberRanges } from "@/domain/numbering/ranges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const org = await getActiveOrg();
  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "year muss eine ganze Zahl sein." }, { status: 400 });
  }
  const ranges = await listNumberRanges(org.id, year);
  return NextResponse.json({ ranges });
}
