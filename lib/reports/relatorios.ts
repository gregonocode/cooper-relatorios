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

// NOVO: tipo para rastreio real (producao_consumos)
type RowProducaoConsumo = {
  id: number | string;
  producao_id: number | string;
  materia_prima_id: number | string;
  lote_id: number | string | null;
  quantidade?: number | string | null;
  created_at?: string | null;
};

// Índice: producao_id -> mp_id -> [numero_lote]
type ConsumosIndex = Map<number, Map<number, { lotes: string[]; total: number }>>;

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
// NOVO: permite forçar via env se precisar
function isProdRuntime() {
  if (process.env.CHROMIUM_FORCE_PROD === "1") return true;
  // Vercel / Lambda markers
  if (process.env.NEXT_RUNTIME === "nodejs") return true;
  if (process.env.AWS_REGION || process.env.LAMBDA_TASK_ROOT) return true;
  if (process.env.VERCEL) return true; // any truthy value indicates Vercel
  // Default to prod quando NODE_ENV=production (mais seguro em deploy)
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
        materiaPrimaId: number;     // 👈 NOVO: id da MP pra tratar DDG
        materiaPrimaNome: string;
        unidade: string;
        loteUsado: string;          // "A/B/C" (FIFO simulado) ou "[sem lote elegível]"
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

  /* seção por lote; a partir da 2ª, forçar nova página */
  .section { }
  .section.break {
    break-before: page;
    page-break-before: always;
  }

  .group { margin: 10px 0 12px; padding: 6px 10px; background: #eee; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  tbody.block { page-break-inside: avoid; } /* 👈 Cada fórmula (bloco) não quebra de página */
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

  ${grupos.map((g, idx) => `
    <div class="section ${idx > 0 ? "break" : ""}">
      <table>
        <thead>
          <tr>
            <th>Fórmula / Matéria-Prima</th>
            <th>Lote</th>
            <th>Quantidade</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="3" class="group"><strong>Lote de Produção:</strong> ${g.loteProducao}</td></tr>
        </tbody>
        ${g.blocos.map((b) => `
          <tbody class="block">
            <tr class="blk-title">
              <td class="center"><strong>${b.formulaNome}</strong></td>
              <td class="center"><strong>${b.loteProducao}</strong></td>
              <td class="right"><strong>${b.quantidadeProduzida.toFixed(2)} btd</strong></td>
            </tr>
            ${b.linhas.map((ln) => `
              <tr>
                <td>${"&nbsp;&nbsp;"}${ln.materiaPrimaNome}</td>
                <td class="center">${
                  ln.materiaPrimaId === 23
                    ? ""
                    : (ln.loteUsado || "[sem lote elegível]")
                }</td>
                <td class="right">${ln.quantidadeNecessaria.toFixed(2)} ${ln.unidade}</td>
              </tr>
            `).join("")}
            <tr>
              <td colspan="3" class="ensaque"><strong>Quantidade de ensaque:</strong></td>
            </tr>
          </tbody>
        `).join("")}
      </table>
    </div>
  `).join("")}

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

  // 🔹 NOVO: rastreio real (sem depender de user_id aqui)
  const consumosQuery = supabase
    .from("producao_consumos")
    .select("id, producao_id, materia_prima_id, lote_id, quantidade, created_at");

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
    { data: consumos, error: e5 },
  ] = await Promise.all([producoesQuery, materiasQuery, lotesQuery, formulasQuery, consumosQuery]);

  if (e1 || e2 || e3 || e4 || e5) {
    throw new Error(
      `Erro ao buscar dados: ${e1?.message ?? ""} ${e2?.message ?? ""} ${e3?.message ?? ""} ${e4?.message ?? ""} ${e5?.message ?? ""}`.trim()
    );
  }

  // 🔹 se veio userId, filtramos consumos pelos IDs de produções filtradas
  const producoesIdsSet = new Set((producoes ?? []).map(p => Number(p.id)));
  const consumosFiltrados = (consumos ?? []).filter(c => producoesIdsSet.has(Number(c.producao_id)));

  return {
    producoes: (producoes ?? []) as RowProducao[],
    materias: (materias ?? []) as RowMateriaPrima[],
    lotes: (lotes ?? []) as RowLote[],
    formulas: (formulas ?? []) as RowFormula[],
    consumos: consumosFiltrados as RowProducaoConsumo[], // 🔹 NOVO
  };
}

export function normalizarDadosCarregados(raw: {
  materias: RowMateriaPrima[];
  producoes: RowProducao[];
  lotes: RowLote[];
  formulas: RowFormula[];
  consumos: RowProducaoConsumo[]; // 🔹 NOVO
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
    quantidadeRecebida: Number(l.quantidade_recebida ?? 0),
    quantidadeAtual: Number(l.quantidade_atual ?? 0),
    dataRecebimento: String(l.data_recebimento),
  }));
  // Mapa: lote_id -> numero_lote
  const lotesById = new Map<number, string>();
  for (const l of lotesNorm) {
    lotesById.set(l.id, l.numeroLote);
  }

  // 🔹 NOVO: índice de consumos reais
  const consumosIndex: ConsumosIndex = new Map();
  for (const c of raw.consumos) {
    const pid = Number(c.producao_id);
    const mp = Number(c.materia_prima_id);
    const loteId = c.lote_id != null ? Number(c.lote_id) : null;
    const numero = loteId != null ? (lotesById.get(loteId) ?? "") : "";

    if (!consumosIndex.has(pid)) consumosIndex.set(pid, new Map());
    const byMp = consumosIndex.get(pid)!;
    if (!byMp.has(mp)) byMp.set(mp, { lotes: [], total: 0 });
    const entry = byMp.get(mp)!;

    const q = Number(c.quantidade ?? 0);
    if (!Number.isNaN(q)) entry.total += q;
    if (numero && !entry.lotes.includes(numero)) entry.lotes.push(numero);
  }
  return { mpById, formulaById, producoesNorm, lotesNorm, consumosIndex };
}

/* ========== Reconstrução FIFO por lote (com fallback) ========== */
/**
 * Regras:
 * 1) Primeiro tenta usar apenas lotes com data_recebimento <= data_producao (FIFO "correto").
 * 2) Se não conseguir usar NENHUM lote (ou seja, daria "[sem lote elegível]"),
 *    faz fallback: usa qualquer lote com saldo (ignorando data), ainda em FIFO.
 * 3) Só retorna "[sem lote elegível]" se não houver saldo em lote nenhum para aquela MP.
 */
function reconstruirConsumoPorLotesFIFO(params: {
  producoes: Producao[];
  lotes: Lote[];
}): Map<number, Map<number, string[]>> {
  const { producoes, lotes } = params;

  type FilaItem = { numero: string; data: Date; saldo: number };

  // Fila FIFO por matéria-prima (ordenada por data_recebimento)
  const filasPorMP = new Map<number, FilaItem[]>();

  for (const l of lotes) {
    const mpId = l.materiaPrimaId;
    const arr = filasPorMP.get(mpId) ?? [];
    arr.push({
      numero: l.numeroLote,
      data: new Date(l.dataRecebimento),
      saldo: l.quantidadeRecebida,
    });
    filasPorMP.set(mpId, arr);
  }

  // Ordena cada fila por data (FIFO)
  for (const arr of filasPorMP.values()) {
    arr.sort((a, b) => a.data.getTime() - b.data.getTime());
  }

  // Produções em ordem cronológica
  const producoesOrdenadas = [...producoes].sort(
    (a, b) => new Date(a.dataProducao).getTime() - new Date(b.dataProducao).getTime()
  );

  const lotesUsadosPorProducao = new Map<number, Map<number, string[]>>();

  for (const p of producoesOrdenadas) {
    const usadosNaProducao = new Map<number, string[]>();
    const dataProd = new Date(p.dataProducao);

    for (const [mpIdStr, qtdTotal] of Object.entries(p.materiaPrimaConsumida)) {
      const mpId = Number(mpIdStr);
      let restante = Number(qtdTotal);
      const fila = filasPorMP.get(mpId);

      if (!fila || restante <= 0) {
        usadosNaProducao.set(mpId, ["[sem lote elegível]"]);
        continue;
      }

      const usados: string[] = [];

      // 1) Tenta consumir somente de lotes com data_recebimento <= dataProducao
      for (const item of fila) {
        if (item.data.getTime() > dataProd.getTime()) continue;
        if (restante <= 0) break;
        if (item.saldo <= 0) continue;

        const consumir = Math.min(item.saldo, restante);
        if (consumir > 0) {
          item.saldo -= consumir;
          restante -= consumir;
          if (!usados.includes(item.numero)) {
            usados.push(item.numero);
          }
        }
      }

      // 2) Fallback: se não conseguimos usar NENHUM lote "válido no tempo",
      //    mas ainda há consumo pendente, tentamos em QUALQUER lote com saldo (ignorando data)
      if (usados.length === 0 && restante > 0) {
        for (const item of fila) {
          if (restante <= 0) break;
          if (item.saldo <= 0) continue;

          const consumir = Math.min(item.saldo, restante);
          if (consumir > 0) {
            item.saldo -= consumir;
            restante -= consumir;
            if (!usados.includes(item.numero)) {
              usados.push(item.numero);
            }
          }
        }
      }

      // 3) Decide o que registrar no relatório
      if (usados.length === 0) {
        // não tinha saldo em lote nenhum dessa MP
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
const SHOW_ZERO_LINES = true;
function getComponentMpIdRaw(c: any): unknown {
  return c?.materia_prima_id ?? c?.materia_prima ?? c?.materiaPrimaId ?? c?.mp_id ?? c?.mpId ?? c?.id_mp ?? c?.id;
}
function normalizeMpId(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
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

  // 3) Normalizar (agora com consumosIndex)
  const { mpById, formulaById, producoesNorm, lotesNorm, consumosIndex } = normalizarDadosCarregados(raw);

  // 4) Reconstruir consumo por lote (FIFO) p/ TODA a história até 'to'
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

  // 6) Montar estrutura para HTML usando rastreio real com fallback FIFO
  const gruposForHTML = gruposOrdenados.map(([loteProducao, prods]) => {
    const blocos = prods.map((p) => {
      const formulaNome = formulaById.get(p.formulaId)?.nome ?? `Fórmula ${p.formulaId}`;

      const formula = formulaById.get(p.formulaId);
      const rawComponents = (formula?.componentes || []) as any[];
      const compIds = rawComponents
        .map((c) => normalizeMpId(getComponentMpIdRaw(c)))
        .filter((n): n is number => n !== null);

      const consumedIds = Object.keys(p.materiaPrimaConsumida || {})
        .map((k) => Number(k))
        .filter((n) => Number.isFinite(n));
      const realKeys = Array.from(consumosIndex.get(p.id)?.keys() ?? []);
      const allMpIds = Array.from(new Set<number>([...compIds, ...consumedIds, ...realKeys]));
      allMpIds.sort((a, b) => a - b);

      const usadosDaProducaoFIFO = lotesUsados.get(p.id) ?? new Map<number, string[]>();

      const linhas = allMpIds
        .map((mpId) => {
          const mp = mpById.get(mpId);
          const real = consumosIndex.get(p.id)?.get(mpId) ?? null;

          // Quantidade final: prioriza o que veio de producao_consumos (real),
          // se não tiver, cai pro JSON.
          const qtdJson = Number(p.materiaPrimaConsumida?.[String(mpId)] ?? 0);
          const qtdFinal = (real?.total ?? qtdJson ?? 0);

          // Lotes sugeridos pelo FIFO global
          const fifo = usadosDaProducaoFIFO.get(mpId) ?? ["[sem lote elegível]"];
          const fifoIsPlaceholder =
            fifo.length === 1 && fifo[0] === "[sem lote elegível]";

          // Lotes registrados “reais”
          const realLotes = real?.lotes ?? [];

          let lotesLista: string[] = [];

          // Casos:
          // 1) Só FIFO tem algo útil  -> usa FIFO
          // 2) Só REAL tem algo       -> usa REAL
          // 3) Os dois têm algo       -> faz união (FIFO + REAL)
          // 4) Nenhum tem (só placeholder) -> mantém placeholder
          if (realLotes.length === 0 && !fifoIsPlaceholder) {
            lotesLista = fifo;
          } else if (realLotes.length > 0 && fifoIsPlaceholder) {
            lotesLista = realLotes;
          } else if (realLotes.length > 0 && !fifoIsPlaceholder) {
            // Une FIFO + REAL sem duplicar, preservando a ordem FIFO primeiro
            const merged = [...fifo, ...realLotes];
            const seen = new Set<string>();
            lotesLista = merged.filter((lt) => {
              if (seen.has(lt)) return false;
              seen.add(lt);
              return true;
            });
          } else {
            // realLotes vazio e FIFO só com "[sem lote elegível]"
            lotesLista = fifo;
          }

          let loteUsadoStr = lotesLista.length
            ? lotesLista.join("/")
            : "[sem lote elegível]";

          if (qtdFinal === 0) {
            loteUsadoStr = "[não consumido]";
          }

          if (!SHOW_ZERO_LINES && qtdFinal === 0) return null;

          return {
            materiaPrimaId: mpId, // 👈 passa id da MP pro HTML decidir o lote (caso DDG)
            materiaPrimaNome: mp?.nome ?? `MP ${mpId}`,
            unidade: mp?.unidadeMedida ?? "",
            loteUsado: loteUsadoStr,
            quantidadeNecessaria: qtdFinal,
          };
        })
        .filter(Boolean) as Array<{
          materiaPrimaId: number;
          materiaPrimaNome: string;
          unidade: string;
          loteUsado: string;
          quantidadeNecessaria: number;
        }>;

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

  // ======= Cabeçalho e rodapé =======

  const headerTemplate = `
    <div style="font-size:10px; width:100%; padding:0 12mm;">
      <div style="display:grid; grid-template-columns: 1fr auto 1fr; align-items:center; column-gap:12px;">
        <div style="justify-self:start;">
          ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Selo" style="height:28px; width:auto; display:block;" />` : ``}
        </div>
        <div style="justify-self:center; text-align:center; font-weight:700; font-size:14px;">
          Controle de Produção - Mistura/Ensaque
        </div>
        <div style="justify-self:end; font-size:10px; text-align:right; line-height:1.4;">
          <div><span>Nº Documento: </span><strong>BPF 18</strong></div>
          <div>Data: 03/02/2025</div>
        </div>
      </div>
      <div style="margin-top:6px; padding:8px; background:#f5f5f5; border-radius:6px; font-size:10px; font-weight:700;">
        Período: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
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
