"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { Toaster, toast } from "react-hot-toast";

const BRAND = {
  yellow: "#FFC107",
  yellowDark: "#FFB300",
  textDark: "#111827",
};

const supabase =
  typeof window !== "undefined"
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
      )
    : (null as unknown as ReturnType<typeof createClient>);

export default function LoginPage() {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPw, setShowPw] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        toast.success("Você já está logado. Redirecionando…");
        window.location.href = "/dashboard";
      }
    })();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!supabase) {
      toast.error("Supabase não configurado no browser.");
      return;
    }
    if (!email || !password) {
      toast("Preencha e-mail e senha.", { icon: "⚠️" });
      return;
    }

    setLoading(true);
    try {
      await toast.promise(
        supabase.auth.signInWithPassword({ email, password }),
        {
          loading: "Autenticando…",
          success: "Login realizado! Redirecionando…",
          error: (err) =>
            (err as { message?: string })?.message ??
            "Falha ao autenticar. Verifique suas credenciais.",
        }
      );
      window.location.href = "/dashboard";
    } catch {
      // o toast de erro já tratou a mensagem
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <Toaster position="top-right" toastOptions={{ duration: 2500 }} />

      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
        {/* Painel esquerdo (brand) */}
        <section
          className="relative hidden lg:flex flex-col justify-between p-12"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,193,7,1) 0%, rgba(255,179,0,1) 100%)",
          }}
        >
          <div className="absolute inset-0 opacity-15 pointer-events-none">
            <svg width="100%" height="100%">
              <defs>
                <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.6)" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#dots)" />
            </svg>
          </div>

          <header className="relative z-10">
            <div className="inline-flex items-baseline gap-2">
              <span
                className="text-3xl font-extrabold tracking-tight"
                style={{ color: BRAND.textDark }}
              >
                Cooperneo
              </span>
            </div>
          </header>

          <div className="relative z-10">
            <h1
              className="text-5xl font-extrabold leading-tight"
              style={{ color: BRAND.textDark }}
            >
              Gerencie seus relatórios!
            </h1>
            <p className="mt-4 text-lg/7" style={{ color: "rgba(17,24,39,0.85)" }}>
              Geração de PDF por período, organizada e estável. Simples assim.
            </p>
          </div>

          <footer
            className="relative z-10 text-sm"
            style={{ color: "rgba(17,24,39,0.7)" }}
          >
            © {new Date().getFullYear()} Cooperneo
          </footer>
        </section>

        {/* Coluna direita (login) */}
        <section className="flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            <div className="mb-8 text-center lg:hidden">
              <div
                className="mx-auto mb-4 h-16 w-16 rounded-2xl shadow"
                style={{ backgroundColor: BRAND.yellow }}
              />
              <h1 className="text-3xl font-extrabold mt-2">Cooperneo</h1>
              <p className="text-sm text-gray-600">Gerencie seus relatórios!</p>
            </div>

            <div className="rounded-2xl bg-white p-8 shadow-xl ring-1 ring-black/5">
              <h2 className="mb-1 text-2xl font-bold text-gray-900">Entrar</h2>
              <p className="mb-6 text-sm text-gray-600">
                Acesse sua conta para gerar relatórios em PDF.
              </p>

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    E-mail
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
                    placeholder="SeuEmail@exemplo.com"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Senha
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPw ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 pr-10 text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute inset-y-0 right-2 grid place-items-center rounded-md p-2 text-gray-500 hover:bg-gray-100"
                      aria-label={showPw ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group relative inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold transition hover:opacity-95 disabled:opacity-60"
                  style={{ backgroundColor: BRAND.yellowDark, color: BRAND.textDark }}
                >
                  <LogIn size={18} className="transition group-hover:translate-x-0.5" />
                  {loading ? "Entrando..." : "Entrar"}
                </button>

                
              </form>
            </div>

            <p className="mt-6 text-center text-xs text-gray-500">
              Esqueceu a senha?{" "}
              <a
                href="#"
                className="font-medium underline decoration-transparent transition hover:decoration-inherit"
                style={{ color: BRAND.yellowDark }}
              >
                Recuperar acesso
              </a>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
