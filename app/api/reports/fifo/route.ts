// app/api/reports/fifo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { gerarRelatorioPersonalizadoPDF, getLaunchDebugInfo } from "@/lib/reports/relatorios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function asArrayBuffer(u8: Uint8Array) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

export async function GET(req: NextRequest) {
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") ?? "2025-06-01";
    const to = url.searchParams.get("to") ?? "2025-06-30";
    const userId = url.searchParams.get("userId") ?? undefined;

    const res = await gerarRelatorioPersonalizadoPDF({ from, to, userId });

    console.log("[FIFO][GET] LaunchInfo:", getLaunchDebugInfo());

    if ("url" in (res as any) && (res as any).url) {
      return NextResponse.redirect((res as any).url);
    }

    const pdf = res.buffer as Uint8Array;
    const arrayBuffer = asArrayBuffer(pdf);

    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="fifo_${from}_a_${to}.pdf"`,
    };

    // expose basic debug info in headers (não sensível)
    const li = getLaunchDebugInfo();
    headers["x-chromium-mode"] = li?.mode ?? "n/a";
    headers["x-chromium-path"] = (li?.execPath ?? "null").slice(-40); // só tail por segurança

    return new NextResponse(arrayBuffer as ArrayBuffer, { status: 200, headers });
  } catch (e: unknown) {
    console.error("[FIFO][GET] ERROR:", e, "LaunchInfo:", getLaunchDebugInfo());
    if (new URL(req.url).searchParams.get("debug") === "1") {
      return new NextResponse(
        `ERROR\n${String(e)}\n\nLaunchInfo: ${JSON.stringify(getLaunchDebugInfo())}`,
        { status: 500, headers: { "Content-Type": "text/plain" } }
      );
    }
    return NextResponse.json({ ok: false, where: "GET", error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  try {
    const body = await req.json().catch(() => ({}));
    const from = body.from ?? "2025-06-01";
    const to = body.to ?? "2025-06-30";
    const userId = body.userId ?? undefined;

    const res = await gerarRelatorioPersonalizadoPDF({ from, to, userId });

    console.log("[FIFO][POST] LaunchInfo:", getLaunchDebugInfo());

    if ("url" in (res as any) && (res as any).url) {
      return NextResponse.json({ ok: true, url: (res as any).url, ms: Date.now() - t0 });
    }

    const pdf = res.buffer as Uint8Array;
    const arrayBuffer = asArrayBuffer(pdf);

    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="fifo_${from}_a_${to}.pdf"`,
      "X-Render-Time": `${Date.now() - t0}ms`,
    };

    const li = getLaunchDebugInfo();
    headers["x-chromium-mode"] = li?.mode ?? "n/a";
    headers["x-chromium-path"] = (li?.execPath ?? "null").slice(-40);

    return new NextResponse(arrayBuffer as ArrayBuffer, { status: 200, headers });
  } catch (e: unknown) {
    console.error("[FIFO][POST] ERROR:", e, "LaunchInfo:", getLaunchDebugInfo());
    if (debug) {
      return new NextResponse(
        `ERROR\n${String(e)}\n\nLaunchInfo: ${JSON.stringify(getLaunchDebugInfo())}`,
        { status: 500, headers: { "Content-Type": "text/plain" } }
      );
    }
    return NextResponse.json({ ok: false, where: "POST", error: String(e) }, { status: 500 });
  }
}
