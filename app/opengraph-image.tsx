import { ImageResponse } from "next/og";
import { brand, yearsInBusiness } from "@/lib/config";

/**
 * Imagem de compartilhamento gerada no build.
 *
 * O site atual não tem Open Graph nenhum: cada link colado no WhatsApp ou no
 * Instagram aparece sem imagem e sem texto. Para um negócio que vende por
 * essas duas vias, é aquisição jogada fora a cada compartilhamento.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${brand.name} — tortas artesanales con delivery en ${brand.city}`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#fffcf5",
          fontFamily: "Georgia, serif",
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 16, background: "#f7c118" }} />

        <div style={{ display: "flex", fontSize: 26, letterSpacing: 12, color: "#806047", marginBottom: 8 }}>
          DESDE {brand.since}
        </div>

        <div style={{ display: "flex", fontSize: 86, fontWeight: 700, color: "#3b2314" }}>{brand.name}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "26px 0" }}>
          <div style={{ width: 90, height: 2, background: "#e2a900" }} />
          <div style={{ width: 14, height: 14, borderRadius: 7, background: "#e2a900" }} />
          <div style={{ width: 90, height: 2, background: "#e2a900" }} />
        </div>

        <div style={{ display: "flex", fontSize: 38, color: "#5a3a24", textAlign: "center", maxWidth: 900 }}>
          Tortas artesanales con delivery en {brand.city}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 40,
            gap: 16,
            fontSize: 24,
            fontFamily: "system-ui, sans-serif",
            color: "#3b2314",
          }}
        >
          <span style={{ display: "flex", background: "#f7c118", padding: "14px 28px", borderRadius: 999 }}>
            Eliges día y hora de entrega
          </span>
          <span
            style={{
              display: "flex",
              border: "2px solid #f0e2c8",
              padding: "14px 28px",
              borderRadius: 999,
              color: "#5a3a24",
            }}
          >
            Más de {yearsInBusiness} años
          </span>
        </div>
      </div>
    ),
    size,
  );
}
