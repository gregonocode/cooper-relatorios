// app/api/reports/_chromium-check/route.ts
import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  let browser: import("puppeteer-core").Browser | null = null;
  try {
    const execPath = await chromium.executablePath();

    const launchOpts: Parameters<typeof puppeteer.launch>[0] = {
      args: chromium.args,
      executablePath: execPath ?? undefined,
      headless: "new", // 👈 evita o erro de tipagem
      defaultViewport: { width: 800, height: 600 },
    };

    browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();
    await page.setContent("<html><body><h1>ok</h1></body></html>", { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4" });
    await browser.close();

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "x-exec-path-tail": (execPath ?? "null").slice(-40),
      },
    });
  } catch (e) {
    if (browser) try { await browser.close(); } catch {}
    return new NextResponse(String(e), { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}
