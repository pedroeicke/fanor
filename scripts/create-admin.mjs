/**
 * Cria (ou reaproveita) uma conta de acesso ao painel.
 *
 * São dois passos, e os dois são necessários: a conta no Supabase Auth e a
 * linha em `admins`. Ter conta não dá acesso ao painel — é a linha que dá.
 *
 * Uso:
 *   npm run db:admin -- correo@ejemplo.com "Nombre Completo" [senha]
 *
 * Sem senha, gera uma e imprime uma única vez.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const [, , email, name, passwordArg] = process.argv;

if (!email || !name) {
  console.error('Uso: npm run db:admin -- correo@ejemplo.com "Nombre Completo" [senha]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const password = passwordArg ?? randomBytes(9).toString("base64url");
const db = createClient(url, key, { auth: { persistSession: false } });

/* A Admin API não tem "buscar por e-mail": lista e filtra. Suficiente para
   uma equipe de padaria; se um dia passar de mil contas, paginar. */
const { data: list, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
if (listError) {
  console.error("Falha ao listar usuários:", listError.message);
  process.exit(1);
}

let user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
let created = false;

if (user) {
  /* Conta existente: só redefine a senha se ela foi passada de propósito. */
  if (passwordArg) {
    const { error } = await db.auth.admin.updateUserById(user.id, { password });
    if (error) {
      console.error("Falha ao atualizar a senha:", error.message);
      process.exit(1);
    }
  }
} else {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    console.error("Falha ao criar o usuário:", error.message);
    process.exit(1);
  }
  user = data.user;
  created = true;
}

const { error: adminError } = await db
  .from("admins")
  .upsert({ user_id: user.id, name, role: "owner" }, { onConflict: "user_id" });

if (adminError) {
  console.error("Falha ao dar acesso ao painel:", adminError.message);
  process.exit(1);
}

console.log(`✓ ${created ? "Conta criada" : "Conta já existia"} e com acesso ao painel`);
console.log(`  e-mail : ${email}`);
if (created || passwordArg) console.log(`  senha  : ${password}`);
console.log(`  entrar : /admin/login`);
if (created && !passwordArg) {
  console.log("\n  ⚠ Anote a senha: ela não é recuperável, só redefinível.");
}
