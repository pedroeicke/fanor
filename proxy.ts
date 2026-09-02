import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Renova a sessão do Supabase e barra o painel.
 *
 * É o `proxy.ts` do Next 16 — o antigo `middleware.ts`, que ficou obsoleto
 * nesta versão e só mudou de nome e de export. O proxy é a primeira trava; a
 * segunda são as políticas de RLS, que devolvem vazio para quem não está em
 * `admins`. Uma falha aqui não expõe dado — só deixaria a pessoa ver uma
 * tela vazia.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  /* getUser() revalida o token com o servidor do Supabase. getSession() lê o
     cookie sem verificar, e cookie é falsificável. */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login" && !user) {
    const login = request.nextUrl.clone();
    login.pathname = "/admin/login";
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (pathname === "/admin/login" && user) {
    const admin = request.nextUrl.clone();
    admin.pathname = "/admin";
    admin.search = "";
    return NextResponse.redirect(admin);
  }

  return response;
}

export const config = {
  /* Só o painel. Deixar o proxy rodar na loja inteira custaria uma chamada
     de autenticação em cada página pública, sem nenhum ganho. */
  matcher: ["/admin/:path*"],
};
