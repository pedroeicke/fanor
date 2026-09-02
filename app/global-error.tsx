"use client";

/**
 * Erro no próprio layout raiz.
 *
 * Substitui o <html> inteiro, então não pode usar nada do layout — nem as
 * fontes, nem os tokens de cor, nem componente algum. Por isso o estilo vai
 * inline: se o CSS é o que quebrou, uma classe aqui também não funcionaria.
 *
 * É a última rede antes da tela branca.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es-PE">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#fffcf5",
          color: "#3b2314",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <p style={{ fontSize: 44, fontWeight: 700, margin: 0, fontFamily: "Georgia, serif" }}>
            Tortas Fanor
          </p>
          <h1 style={{ fontSize: 22, marginTop: 20, fontWeight: 600 }}>
            La página no pudo cargarse
          </h1>
          <p style={{ color: "#806047", lineHeight: 1.6, marginTop: 10 }}>
            Estamos con un problema técnico. Intenta de nuevo en unos minutos o escríbenos por
            WhatsApp.
          </p>

          <button
            onClick={reset}
            style={{
              marginTop: 24,
              height: 52,
              padding: "0 32px",
              border: 0,
              borderRadius: 999,
              background: "#f7c118",
              color: "#3b2314",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Intentar de nuevo
          </button>

          {error.digest && (
            <p style={{ marginTop: 28, fontSize: 12, color: "#8a6c54", fontFamily: "monospace" }}>
              Referencia: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
