// app/api/reports/_chromium-check/route.ts
import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Tipagem com headless opcional e possivelmente "new"
type ChromiumWithHeadless = typeof chromium & {
  headless?: boolean | "new" | "shell";
};

// Normaliza headless para o type aceito pelo puppeteer-core v24: boolean | "shell"
function normalizeHeadless(c: ChromiumWithHeadless): boolean | "shell" {
  const h = c.headless;
  if (h === "new") return true;       // mapeia "new" -> true
  if (h === undefined) return true;   // fallback seguro
  return h as boolean | "shell";
}

// Converte Uint8Array (possivelmente baseado em SharedArrayBuffer) em ArrayBuffer "limpo"
function toCleanArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

export async function GET() {
  let browser: import("puppeteer-core").Browser | null = null;

  try {
    const execPath = await chromium.executablePath();

    const launchOpts: Parameters<typeof puppeteer.launch>[0] = {
      args: chromium.args,
      executablePath: execPath ?? undefined,
      headless: normalizeHeadless(chromium as ChromiumWithHeadless),
      defaultViewport: { width: 800, height: 600 },
    };

    browser = await puppeteer.launch(launchOpts);

    const page = await browser.newPage();
    await page.setContent("<html><body><h1>ok</h1></body></html>", {
      waitUntil: "networkidle0",
    });

    const pdf = await page.pdf({ format: "A4" }); // Uint8Array
    await browser.close();
    browser = null;

    const arrayBuffer = toCleanArrayBuffer(pdf);

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "x-exec-path-tail": (execPath ?? "null").slice(-40),
      },
    });
  } catch (e) {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    return new NextResponse(String(e), {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
