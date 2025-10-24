// lib/reports/relatorios.ts
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Tipo derivado da função (à prova de versão)
type LaunchOpts = Parameters<typeof puppeteer.launch>[0];

let __lastLaunchInfo: { mode: "prod" | "dev"; execPath: string | null } = { mode: "dev", execPath: null };
export function getLaunchDebugInfo() { return __lastLaunchInfo; }

/* =========================
   Tipos alinhados ao schema
   ========================= */
export type MateriaPrima = {
  id: number;             // materias_primas.id
  nome: string;           // materias_primas.nome
  unidadeMedida: string;  // materias_primas.unidade_medida
};

export type FormulaComponente = {
  quantidade: number;
  unidade_medida: string;
  materia_prima_id: string; // conforme seu JSON
};

export type Formula = {
  id: number;             // formulas.id
  nome: string;           // formulas.nome
  componentes?: FormulaComponente[];
};

export type Producao = {
  id: number;                  // producoes.id
  formulaId: number;           // producoes.formula_id
  loteProducao: string;        // producoes.lote_producao
  quantidadeProduzida: number; // producoes.quantidade_produzida
  dataProducao: string;        // producoes.data_producao (ISO)
  materiaPrimaConsumida: Record<string, number>; // producoes.materia_prima_consumida
};

export type Lote = {
  id: number;                 // lotes.id
  materiaPrimaId: number;     // lotes.materia_prima_id
  numeroLote: string;         // lotes.numero_lote
  quantidadeRecebida: number; // lotes.quantidade_recebida  (USADO NA SIMULAÇÃO)
  quantidadeAtual: number;    // lotes.quantidade_atual     (apenas referência)
  dataRecebimento: string;    // lotes.data_recebimento (ISO)
};

/* =============== Utils =============== */
function safeParseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return (value as T) ?? fallback;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/* ========== Launch Chromium (dual-path) ========== */
/* ========== Launch Chromium (dual-path) ========== */

// NOVO: permite forçar via env se precisar
function isProdRuntime() {
  if (process.env.CHROMIUM_FORCE_PROD === "1") return true;
  // Vercel / Lambda markers
  if (process.env.NEXT_RUNTIME === "nodejs") return true;
  if (process.env.AWS_REGION || process.env.LAMBDA_TASK_ROOT) return true;
  if (process.env.VERCEL) return true; // any truthy value indicates Vercel
  // Default to prod when NODE_ENV=production (safer on deployments)
  if (process.env.NODE_ENV === "production") return true;
  return false;
}

async function resolveExecutablePathForDev(): Promise<string | null> {
  try {
    // tenta puppeteer "cheio" no dev
    const mod: any = await import("puppeteer");
    if (typeof mod?.executablePath === "function") {
      const p = mod.executablePath();
      if (typeof p === "string" && p.length > 0) return p;
    }
    if (typeof mod?.default?.executablePath === "function") {
      const p = mod.default.executablePath();
      if (typeof p === "string" && p.length > 0) return p;
    }
  } catch { /* ignore */ }

  const fs = await import("fs");
  const candidates = [
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function launchBrowser() {
  if (isProdRuntime()) {
    __lastLaunchInfo = { mode: "prod", execPath: await chromium.executablePath() };
    const launchOptions: LaunchOpts = {
      args: chromium.args,
      executablePath: __lastLaunchInfo.execPath || undefined,
      headless: true,
      defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
    };
    return puppeteer.launch(launchOptions);
  } else {
    const execPath = (await resolveExecutablePathForDev()) || (await chromium.executablePath());
    __lastLaunchInfo = { mode: "dev", execPath: execPath ?? null };
    if (!execPath) throw new Error("Chrome/Chromium não encontrado no dev.");
    const launchOptions: LaunchOpts = {
      args: [],
      executablePath: execPath,
      headless: true,
      defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
    };
    return puppeteer.launch(launchOptions);
  }
}

/* ========== HTML (tabela estilo Excel) ========== */
function renderHTML(params: {
  from: string; // "YYYY-MM-DD"
  to: string;   // "YYYY-MM-DD"
  grupos: Array<{
    loteProducao: string;
    blocos: Array<{
      formulaNome: string;
      loteProducao: string;
      quantidadeProduzida: number;
      linhas: Array<{
        materiaPrimaNome: string;
        unidade: string;
        loteUsado: string;      // "A/B/C" (FIFO simulado) ou "[sem lote elegível]"
        quantidadeNecessaria: number;
      }>;
    }>;
  }>;
}) {
  const { grupos } = params;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page { size: A4 portrait; margin: 90px 12mm 110px; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; }
  .group { margin: 10px 0 12px; padding: 6px 8px; background: #eee; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  th, td { border: 1px solid #ddd; padding: 6px; }
  th { background: #FFF4CC; text-align: center; }
  .right { text-align: right; }
  .center { text-align: center; }
  .muted { color: #666; }
  .blk-title { background:#f2f2f2; }
  .ensaque { border: 1px solid #ddd; border-top: 0; padding: 6px; }
</style>
</head>
<body>

  <table>
    <thead>
      <tr>
        <th>Fórmula / Matéria-Prima</th>
        <th>Lote</th>
        <th>Quantidade</th>
      </tr>
    </thead>
    <tbody>
      ${grupos.map((g) => `
        <tr><td colspan="3" class="group"><strong>Lote de Produção:</strong> ${g.loteProducao}</td></tr>
        ${g.blocos.map((b) => `
          <tr class="blk-title">
            <td class="center"><strong>${b.formulaNome}</strong></td>
            <td class="center"><strong>${b.loteProducao}</strong></td>
            <td class="right"><strong>${b.quantidadeProduzida.toFixed(2)} btd</strong></td>
          </tr>
          ${b.linhas.map((ln) => `
            <tr>
              <td>${"&nbsp;&nbsp;"}${ln.materiaPrimaNome}</td>
              <td class="center">${ln.loteUsado || "[sem lote elegível]"}</td>
              <td class="right">${ln.quantidadeNecessaria.toFixed(2)} ${ln.unidade}</td>
            </tr>
          `).join("")}
          <tr>
            <td colspan="3" class="ensaque"><strong>Quantidade de ensaque:</strong></td>
          </tr>
        `).join("")}
      `).join("")}
    </tbody>
  </table>
</body>
</html>`.trim();
}

/* ========== Carregar + Normalizar dados ========== */

// Tipos exatos de linhas lidas do Supabase (sem any)
type RowMateriaPrima = {
  id: number | string;
  user_id?: string | null;
  nome: string | null;
  estoque_atual?: number | string | null;
  unidade_medida: string | null;
  created_at?: string | null;
};

type RowFormula = {
  id: number | string;
  user_id?: string | null;
  nome: string | null;
  componentes?: string | null; // JSON string
  created_at?: string | null;
};

type RowProducao = {
  id: number | string;
  user_id?: string | null;
  formula_id: number | string | null;
  quantidade_produzida: number | string | null;
  data_producao: string;
  created_at?: string | null;
  lote_producao: string | null;
  materia_prima_consumida?: string | null;
};

type RowLote = {
  id: number | string;
  user_id?: string | null;
  materia_prima_id: number | string;
  fornecedor_id?: number | string | null;
  numero_lote: string | null;
  quantidade_recebida?: number | string | null;
  quantidade_atual: number | string | null;
  data_recebimento: string;
  created_at?: string | null;
};

export async function carregarDadosDoBanco(
  supabase: SupabaseClient,
  from: string,
  to: string,
  userId?: string
) {
  const toEndExclusiveISO = addDays(startOfDay(new Date(to)), 1).toISOString();

  // IMPORTANTE: pegamos TODAS as produções até 'to' para simulação FIFO correta
  let producoesQuery = supabase
    .from("producoes")
    .select("id, user_id, formula_id, quantidade_produzida, data_producao, created_at, lote_producao, materia_prima_consumida")
    // .gte("data_producao", from) // <- NÃO filtra por 'from' aqui!
    .lt("data_producao", toEndExclusiveISO)
    .order("data_producao", { ascending: true });

  let materiasQuery = supabase
    .from("materias_primas")
    .select("id, user_id, nome, estoque_atual, unidade_medida, created_at");

  let lotesQuery = supabase
    .from("lotes")
    .select("id, user_id, materia_prima_id, fornecedor_id, numero_lote, quantidade_recebida, quantidade_atual, data_recebimento, created_at");

  let formulasQuery = supabase
    .from("formulas")
    .select("id, user_id, nome, componentes, created_at");

  if (userId) {
    producoesQuery = producoesQuery.eq("user_id", userId);
    materiasQuery = materiasQuery.eq("user_id", userId);
    lotesQuery = lotesQuery.eq("user_id", userId);
    formulasQuery = formulasQuery.eq("user_id", userId);
  }

  const [
    { data: producoes, error: e1 },
    { data: materias, error: e2 },
    { data: lotes, error: e3 },
    { data: formulas, error: e4 },
  ] = await Promise.all([producoesQuery, materiasQuery, lotesQuery, formulasQuery]);

  if (e1 || e2 || e3 || e4) {
    throw new Error(
      `Erro ao buscar dados: ${e1?.message ?? ""} ${e2?.message ?? ""} ${e3?.message ?? ""} ${e4?.message ?? ""}`.trim()
    );
  }

  return {
    producoes: (producoes ?? []) as RowProducao[],
    materias: (materias ?? []) as RowMateriaPrima[],
    lotes: (lotes ?? []) as RowLote[],
    formulas: (formulas ?? []) as RowFormula[],
  };
}

export function normalizarDadosCarregados(raw: {
  materias: RowMateriaPrima[];
  producoes: RowProducao[];
  lotes: RowLote[];
  formulas: RowFormula[];
}) {
  const mpById = new Map<number, MateriaPrima>(
    raw.materias.map((m) => [
      Number(m.id),
      {
        id: Number(m.id),
        nome: String(m.nome ?? ""),
        unidadeMedida: String(m.unidade_medida ?? ""),
      },
    ])
  );

  const formulaById = new Map<number, Formula>(
    raw.formulas.map((f) => [
      Number(f.id),
      {
        id: Number(f.id),
        nome: String(f.nome ?? ""),
        componentes: safeParseJson<FormulaComponente[] | undefined>(f.componentes ?? null, undefined),
      },
    ])
  );

  const producoesNorm: Producao[] = raw.producoes.map((p) => ({
    id: Number(p.id),
    formulaId: Number(p.formula_id ?? 0),
    loteProducao: String(p.lote_producao ?? ""),
    quantidadeProduzida: Number(p.quantidade_produzida ?? 0),
    dataProducao: String(p.data_producao),
    materiaPrimaConsumida: safeParseJson<Record<string, number>>(p.materia_prima_consumida ?? "{}", {}),
  }));

  const lotesNorm: Lote[] = raw.lotes.map((l) => ({
    id: Number(l.id),
    materiaPrimaId: Number(l.materia_prima_id),
    numeroLote: String(l.numero_lote ?? ""),
    quantidadeRecebida: Number(l.quantidade_recebida ?? 0), // <- usamos RECEBIDA
    quantidadeAtual: Number(l.quantidade_atual ?? 0),
    dataRecebimento: String(l.data_recebimento),
  }));

  return { mpById, formulaById, producoesNorm, lotesNorm };
}

/* ========== Reconstrução FIFO por lote (sem producao_consumos) ========== */

/** Distribui todo o consumo histórico por FIFO de lotes.
 *  Retorna: Map<producaoId, Map<materiaPrimaId, string[]>> (números de lote usados por MP em cada produção)
 */
function reconstruirConsumoPorLotesFIFO(params: {
  producoes: Producao[];
  lotes: Lote[];
}): Map<number, Map<number, string[]>> {
  const { producoes, lotes } = params;

  // 1) Preparar filas FIFO por MP (saldo = quantidadeRecebida)
  type FilaItem = { loteId: number; numero: string; data: Date; saldo: number };
  const filasPorMP = new Map<number, FilaItem[]>();

  for (const l of lotes) {
    const arr = filasPorMP.get(l.materiaPrimaId) ?? [];
    arr.push({
      loteId: l.id,
      numero: l.numeroLote,
      data: new Date(l.dataRecebimento),
      saldo: l.quantidadeRecebida,
    });
    filasPorMP.set(l.materiaPrimaId, arr);
  }

  for (const arr of filasPorMP.values()) {
    arr.sort((a, b) => a.data.getTime() - b.data.getTime());
  }

  // 2) Produções em ordem cronológica
  const producoesOrdenadas = [...producoes].sort(
    (a, b) => new Date(a.dataProducao).getTime() - new Date(b.dataProducao).getTime()
  );

  // 3) Resultado
  const lotesUsadosPorProducao = new Map<number, Map<number, string[]>>();

  for (const p of producoesOrdenadas) {
    const usadosNaProducao = new Map<number, string[]>();

    for (const [mpIdStr, qtdTotal] of Object.entries(p.materiaPrimaConsumida)) {
      const mpId = Number(mpIdStr);
      let restante = Number(qtdTotal);
      const fila = filasPorMP.get(mpId) ?? [];
      const usados: string[] = [];

      for (const item of fila) {
        if (restante <= 0) break;
        if (item.saldo <= 0) continue;

        const consumir = Math.min(item.saldo, restante);
        if (consumir > 0) {
          item.saldo -= consumir;
          restante -= consumir;
          if (!usados.includes(item.numero)) usados.push(item.numero);
        }
      }

      if (usados.length === 0) {
        usadosNaProducao.set(mpId, ["[sem lote elegível]"]);
      } else {
        usadosNaProducao.set(mpId, usados);
      }
    }

    lotesUsadosPorProducao.set(p.id, usadosNaProducao);
  }

  return lotesUsadosPorProducao;
}

/* ========== Geração de PDF principal ========== */
export async function gerarRelatorioPersonalizadoPDF(opts: {
  from: string;                // "YYYY-MM-DD"
  to: string;                  // "YYYY-MM-DD"
  userId?: string;             // filtro opcional
  supabase?: SupabaseClient;
  storage?: { bucket: string; pathPrefix?: string; makePublic?: boolean };
}): Promise<{ ok: true; buffer: Buffer; url?: string }> {
  const { from, to, userId } = opts;

  // 1) Cliente Supabase (admin por padrão para Storage/RPC)
  const supabase =
    opts.supabase ??
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

  // 2) Buscar dados reais
  const raw = await carregarDadosDoBanco(supabase, from, to, userId);

  // 3) Normalizar
  const { mpById, formulaById, producoesNorm, lotesNorm } = normalizarDadosCarregados(raw);

  // 4) Reconstruir consumo real por lote (FIFO) p/ TODA a história até 'to'
  const lotesUsados = reconstruirConsumoPorLotesFIFO({
    producoes: producoesNorm,
    lotes: lotesNorm,
  });

  // 5) Agrupar por lote de produção e filtrar pro período [from, to)
  const ini = new Date(from).getTime();
  const fim = addDays(startOfDay(new Date(to)), 1).getTime();

  const grupos = new Map<string, Producao[]>();
  for (const p of producoesNorm) {
    const t = new Date(p.dataProducao).getTime();
    if (t < ini || t >= fim) continue; // mantém relatório só no período
    const list = grupos.get(p.loteProducao) ?? [];
    list.push(p);
    grupos.set(p.loteProducao, list);
  }

  const gruposOrdenados = [...grupos.entries()].sort((a, b) => {
    const [loteA, prodA] = a;
    const [loteB, prodB] = b;
    prodA.sort((x, y) => new Date(x.dataProducao).getTime() - new Date(y.dataProducao).getTime());
    prodB.sort((x, y) => new Date(x.dataProducao).getTime() - new Date(y.dataProducao).getTime());
    const cmp = new Date(prodA[0].dataProducao).getTime() - new Date(prodB[0].dataProducao).getTime();
    return cmp !== 0 ? cmp : loteA.localeCompare(loteB);
  });

  // 6) Montar estrutura para HTML usando a simulação de lotes
  const gruposForHTML = gruposOrdenados.map(([loteProducao, prods]) => {
    const blocos = prods.map((p) => {
      const formulaNome = formulaById.get(p.formulaId)?.nome ?? `Fórmula ${p.formulaId}`;
      const usadosDaProducao = lotesUsados.get(p.id) ?? new Map<number, string[]>();

      const linhas = Object.entries(p.materiaPrimaConsumida).map(([mpIdStr, qtd]) => {
        const mpId = Number(mpIdStr);
        const mp = mpById.get(mpId);
        const lotesLista = usadosDaProducao.get(mpId) ?? ["[sem lote elegível]"];
        return {
          materiaPrimaNome: mp?.nome ?? `MP ${mpId}`,
          unidade: mp?.unidadeMedida ?? "",
          loteUsado: lotesLista.join("/"),
          quantidadeNecessaria: Number(qtd),
        };
      });

      return {
        formulaNome,
        loteProducao: p.loteProducao,
        quantidadeProduzida: p.quantidadeProduzida,
        linhas,
      };
    });

    return { loteProducao, blocos };
  });

  const html = renderHTML({ from, to, grupos: gruposForHTML });

  // 7) Gerar PDF (dual-path launch)
  const browser = await launchBrowser();
  const page = await browser.newPage();

  // === Logo (header) como data URL (arquivo: public/imagens/selo.png) ===
  let logoDataUrl = "";
  try {
    const path = await import("path");
    const fs = await import("fs/promises");
    const logoPath = path.join(process.cwd(), "public", "imagens", "selo.png");
    const buf = await fs.readFile(logoPath);
    logoDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    // Se a logo não existir, seguimos sem quebrar o PDF
    logoDataUrl = "";
  }

  const headerTemplate = `
    <div style="font-size:10px; width:100%; padding:0 12mm;">
      <!-- Grid de 3 colunas: logo | título central | infos à direita -->
      <div style="
        display:grid;
        grid-template-columns: 1fr auto 1fr;
        align-items:center;
        column-gap:12px;
      ">
        <!-- Coluna esquerda: logo -->
        <div style="justify-self:start;">
          ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Selo" style="height:28px; width:auto; display:block;" />` : ``}
        </div>

        <!-- Coluna central: título CENTRALIZADO e +2px -->
        <div style="justify-self:center; text-align:center; font-weight:700; font-size:14px;">
          Controle de Produção - Mistura/Ensaque
        </div>

        <!-- Coluna direita: infos do documento -->
        <div style="justify-self:end; font-size:10px; text-align:right; line-height:1.4;">
          <div><span>Nº Documento: </span><strong>BPF 18</strong></div>
          <div>Data: 03/02/2025</div>
        </div>
      </div>

      <!-- Período -->
      <div style="margin-top:6px; padding:8px; background:#f5f5f5; border-radius:6px; font-size:10px; font-weight:700;">
        Período: &nbsp;&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;
      </div>

      <!-- Paginação movida 8px para cima -->
      <div style="margin-top:-4px; font-size:9px; color:#666;">
        Página <span class="pageNumber"></span> de <span class="totalPages"></span>
      </div>
    </div>`.trim();

  const footerTemplate = `
    <div style="font-size:9px; width:100%; padding:0 12mm 6px 12mm;">
      <table style="width:100%; border-collapse:collapse; font-size:9px;">
        <thead>
          <tr>
            <th style="border:1px solid #ccc; background:#FFF4CC; padding:4px; text-align:center;">Execução</th>
            <th style="border:1px solid #ccc; background:#FFF4CC; padding:4px; text-align:center;">Monitoramento</th>
            <th style="border:1px solid #ccc; background:#FFF4CC; padding:4px; text-align:center;">Verificação</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #ccc; padding:4px;">Responsável: Helves P. Santos</td>
            <td style="border:1px solid #ccc; padding:4px;">Responsável: Pedro Luiz Ferreira</td>
            <td style="border:1px solid #ccc; padding:4px;">Responsável: Franciele A. Santos</td>
          </tr>
          <tr>
            <td style="border:1px solid #ccc; padding:4px;">Data:</td>
            <td style="border:1px solid #ccc; padding:4px;">Data:</td>
            <td style="border:1px solid #ccc; padding:4px;">Data:</td>
          </tr>
          <tr>
            <td style="border:1px solid #ccc; padding:4px;">Assinatura:</td>
            <td style="border:1px solid #ccc; padding:4px;">Assinatura:</td>
            <td style="border:1px solid #ccc; padding:4px;">Assinatura:</td>
          </tr>
        </tbody>
      </table>
    </div>`.trim();

  await page.setContent(html, { waitUntil: "networkidle0" });

  const pdfUint8 = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate,
    footerTemplate,
    margin: { top: "110px", bottom: "110px", left: "12mm", right: "12mm" },
  });

  // Converte para Buffer (compatível com Node)
  const pdfBuffer = Buffer.from(pdfUint8);

  // 8) Salvar no Storage (opcional)
  if (opts.storage) {
    const bucket = opts.storage.bucket;
    const prefix = opts.storage.pathPrefix ?? "relatorios";
    const filename = `${prefix}/personalizado_${from}_a_${to}_${Date.now()}.pdf`;

    const { error } = await supabase.storage
      .from(bucket)
      .upload(filename, pdfBuffer, { contentType: "application/pdf", upsert: true });
    if (error) throw error;

    const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
    return { ok: true as const, buffer: pdfBuffer, url: data.publicUrl };
  }

  return { ok: true as const, buffer: pdfBuffer };
}
