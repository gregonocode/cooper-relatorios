// app/api/reports/fifo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { gerarRelatorioPersonalizadoPDF } from "@/lib/reports/relatorios";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/reports/fifo?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=...
 * Use em <form target="_blank" method="GET" action="/api/reports/fifo">
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") ?? "2025-06-01";
    const to = url.searchParams.get("to") ?? "2025-06-30";
    const userId = url.searchParams.get("userId") ?? undefined;

    const res = await gerarRelatorioPersonalizadoPDF({ from, to, userId });

    // Se você ativar Storage no gerador e vier URL pública:
    if ("url" in (res as any) && (res as any).url) {
      return NextResponse.redirect((res as any).url);
    }

    // Uint8Array/Buffer -> ArrayBuffer “limpo”
    const pdf = res.buffer as Uint8Array;
    const arrayBuffer = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength);

    return new NextResponse(arrayBuffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="fifo_${from}_a_${to}.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, where: "GET", error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/reports/fifo
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", userId?: string }
 * Use em fetch() no client; abra em nova aba criando URL via blob.
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const from = body.from ?? "2025-06-01";
    const to = body.to ?? "2025-06-30";
    const userId = body.userId ?? undefined;

    const res = await gerarRelatorioPersonalizadoPDF({ from, to, userId });

    // Se você ativar Storage no gerador e vier URL pública:
    if ("url" in (res as any) && (res as any).url) {
      return NextResponse.json({ ok: true, url: (res as any).url, ms: Date.now() - t0 });
    }

    // Uint8Array/Buffer -> ArrayBuffer “limpo”
    const pdf = res.buffer as Uint8Array;
    const arrayBuffer = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength);

    return new NextResponse(arrayBuffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="fifo_${from}_a_${to}.pdf"`,
        "X-Render-Time": `${Date.now() - t0}ms`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, where: "POST", error: String(e) }, { status: 500 });
  }
}
