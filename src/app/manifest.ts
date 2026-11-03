import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Grupo Pomar - Central Operacional",
    short_name: "Central Pomar",
    description: "Sua operação, reuniões e recebimentos organizados.",
    start_url: "/central",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7f5",
    theme_color: "#173e30",
    lang: "pt-BR",
    icons: [
      {
        src: "/brand/pomar-metal-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/pomar-metal-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
