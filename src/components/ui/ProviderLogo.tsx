import type { ModelProvider } from "../../types/provider";
import { PROVIDER_LOGOS } from "../../lib/logos";

export default function ProviderLogo({
  provider,
  size = 32,
}: {
  provider: ModelProvider;
  size?: number;
}) {
  const svgSrc = PROVIDER_LOGOS[provider.id];
  if (svgSrc) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-lg"
        style={{
          width: size,
          height: size,
          backgroundColor: provider.brandColor + "18",
        }}
      >
        <img
          src={svgSrc}
          alt={provider.name}
          style={{ width: size * 0.6, height: size * 0.6 }}
        />
      </div>
    );
  }
  const fontSize = provider.logo.length > 1 ? size * 0.36 : size * 0.45;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: provider.brandColor,
        fontSize,
      }}
    >
      {provider.logo}
    </div>
  );
}
