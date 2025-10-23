"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import { Calendar, FileDown, Settings2, Eye, Download, X } from "lucide-react";

const BRAND = {
  yellow: "#FFC107",
  yellowDark: "#FFB300",
  textDark: "#111827",
};

type ApiError = { ok?: false; error?: string };

export default function DashboardPage() {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [from, setFrom] = useState<string>(todayStr);
  const [to, setTo] = useState<string>(todayStr);
  const [loading, setLoading] = useState<boolean>(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("relatorio.pdf");
  const lastObjectUrl = useRef<string | null>(null);

  // Cleanup do blob quando fechar/desmontar
  useEffect(() => {
    return () => {
      if (lastObjectUrl.current) URL.revokeObjectURL(lastObjectUrl.current);
    };
  }, []);

  function setPreset(preset: "today" | "last7" | "last30" | "thisMonth") {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end);

    if (preset === "today") {
      // já está hoje
    } else if (preset === "last7") {
      start.setDate(start.getDate() - 6);
    } else if (preset === "last30") {
      start.setDate(start.getDate() - 29);
    } else if (preset === "thisMonth") {
      start.setDate(1);
    }

    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
    toast.success("Período definido.");
  }

  async function handleGenerate() {
    if (!from || !to) {
      toast("Selecione o período.", { icon: "⚠️" });
      return;
    }
    if (new Date(from) > new Date(to)) {
      toast.error("Data inicial não pode ser maior que a final.");
      return;
    }

    setLoading(true);
    try {
      const res = await toast.promise(
        fetch("/api/reports/fifo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to }),
        }),
        {
          loading: "Gerando PDF…",
          success: "Relatório gerado!",
          error: "Falha ao gerar o relatório.",
        }
      );

      // Rota retorna PDF binário (ArrayBuffer). Se for JSON, é erro.
      const ct = res.headers.get("content-type") || "";
      if (!res.ok) {
        let details = "";
        try {
          const j = (await res.json()) as ApiError;
          details = j?.error || "";
        } catch {}
        throw new Error(details || `HTTP ${res.status}`);
      }
      if (!ct.includes("application/pdf")) {
        // tentou algo diferente -> tenta ler como JSON p/ erro detalhado
        try {
          const j = (await res.json()) as ApiError;
          throw new Error(j?.error || "Resposta inesperada da API.");
        } catch {
          throw new Error("Resposta inesperada da API.");
        }
      }

      // Ok: temos PDF
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (lastObjectUrl.current) URL.revokeObjectURL(lastObjectUrl.current);
      lastObjectUrl.current = url;
      setBlobUrl(url);
      setFileName(`fifo_${from}_a_${to}.pdf`);
      setModalOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao gerar relatório.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function closeModal() {
    setModalOpen(false);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
  }

  function handlePreview() {
    if (!blobUrl) return;
    window.open(blobUrl, "_blank", "noopener,noreferrer");
  }

  function handleDownload() {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName || "relatorio.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="min-h-[60vh]">
      <Toaster position="top-right" toastOptions={{ duration: 2500 }} />

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">
            Gerador de Relatórios
          </h1>
          <p className="text-sm text-gray-600">
            Escolha um período, gere e decida visualizar no navegador ou baixar como arquivo.
          </p>
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          onClick={() => toast("Página de configurações em breve.", { icon: "🛠️" })}
        >
          <Settings2 size={18} />
          Preferências
        </button>
      </div>

      {/* Card de período */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Calendar size={18} />
          Período do Relatório
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="from" className="mb-1 block text-sm font-medium text-gray-700">
              Data inicial
            </label>
            <input
              id="from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
            />
          </div>

          <div>
            <label htmlFor="to" className="mb-1 block text-sm font-medium text-gray-700">
              Data final
            </label>
            <input
              id="to"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
            />
          </div>
        </div>

        {/* Presets */}
        <div className="mt-4 flex flex-wrap gap-2">
          <PresetButton label="Hoje" onClick={() => setPreset("today")} />
          <PresetButton label="Últimos 7 dias" onClick={() => setPreset("last7")} />
          <PresetButton label="Últimos 30 dias" onClick={() => setPreset("last30")} />
          <PresetButton label="Este mês" onClick={() => setPreset("thisMonth")} />
        </div>

        {/* CTA */}
        <div className="mt-6">
          <button
            type="button"
            disabled={loading}
            onClick={handleGenerate}
            className="group inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-semibold transition hover:opacity-95 disabled:opacity-60"
            style={{ backgroundColor: BRAND.yellowDark, color: BRAND.textDark }}
          >
            <FileDown size={18} className="transition group-hover:translate-y-0.5" />
            {loading ? "Gerando…" : "Gerar PDF"}
          </button>
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <Modal onClose={closeModal}>
          <div className="flex items-start justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Relatório pronto</h3>
            <button
              aria-label="Fechar"
              onClick={closeModal}
              className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"
            >
              <X size={18} />
            </button>
          </div>

          <p className="mt-2 text-sm text-gray-600">
            Escolha uma opção para continuar.
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={handlePreview}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 sm:w-auto"
            >
              <Eye size={18} />
              Visualizar no navegador
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-900 hover:opacity-95 sm:w-auto"
              style={{ backgroundColor: BRAND.yellow, color: BRAND.textDark }}
            >
              <Download size={18} />
              Baixar PDF
            </button>
          </div>

          <p className="mt-3 text-xs text-gray-500">{fileName}</p>
        </Modal>
      )}
    </div>
  );
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
    >
      {label}
    </button>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  // fecha com ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
