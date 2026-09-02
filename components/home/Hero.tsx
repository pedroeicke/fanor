import Image from "next/image";
import { ButtonLink } from "@/components/ui/primitives";
import { Flourish, IconArrowRight } from "@/components/ui/icons";
import { brand } from "@/lib/config";

/**
 * Hero da home, seguindo o mockup.
 *
 * A foto sangra até a borda direita: por isso ela sai do container de largura
 * máxima e vira uma camada absoluta na metade direita, em vez de ser a
 * segunda coluna de um grid. No celular volta ao fluxo, empilhada abaixo do
 * texto.
 *
 * Sem selo de nota e sem tarja de entrega — o mockup pede o hero limpo, e a
 * nota real (3,8) viria de diretório, não da ficha do Google.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-crema-200 bg-gradient-to-b from-crema-100 to-crema">
      {/* Asset panorâmico criado para manter a torta à direita e respiro para
          o texto à esquerda. No celular a foto volta ao fluxo. */}
      <div className="relative h-[300px] w-full sm:h-[400px] lg:absolute lg:inset-0 lg:h-full">
        <Image
          src="/assets/hero/imagemhero.png"
          alt="Torta Reina de Peonías decorada con flores rosadas y acabado dorado"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[72%_center] lg:object-center"
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-10 sm:px-6 lg:px-8 lg:py-24">
        <div className="max-w-xl lg:max-w-[42%]">
          <h1 className="text-[2.5rem] leading-[1.06] sm:text-5xl lg:text-[3.5rem]">
            Momentos especiales
            <br className="hidden sm:block" /> merecen una torta
            <br className="hidden sm:block" /> inolvidable
          </h1>

          <Flourish className="mt-5 h-4 w-32 text-dorado-600" />

          <p className="mt-5 max-w-sm text-lg leading-relaxed text-cacao-500">{brand.tagline}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/tortas" size="lg">
              Ver tortas
              <IconArrowRight className="h-[18px] w-[18px]" />
            </ButtonLink>
            <ButtonLink href="/personalizadas" size="lg" variant="outline">
              Personaliza la tuya
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
