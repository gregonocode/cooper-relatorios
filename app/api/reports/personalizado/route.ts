// src/app/api/reports/personalizado/route.ts
import { NextRequest, NextResponse } from "next/server";
import { gerarRelatorioPersonalizadoPDF } from "@/lib/reports/relatorios";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { from, to, userId } = await req.json();
    const { url } = await gerarRelatorioPersonalizadoPDF({
      from,
      to,
      userId,
      storage: { bucket: "relatorios", pathPrefix: "fifo", makePublic: true },
    });
    if (!url) return NextResponse.json({ ok: false, error: "Falha ao gerar URL" }, { status: 500 });
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
