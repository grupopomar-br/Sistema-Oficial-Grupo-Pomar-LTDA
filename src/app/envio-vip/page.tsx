import type { Metadata } from "next";
import MediaIntake from "@/components/media-intake";
import { mediaR2Origin } from "@/lib/config/media";

export const metadata: Metadata = {
  title: "Envio VIP de mídias | Grupo Pomar",
  description: "Envie fotos e vídeos para seu projeto.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <MediaIntake storageOrigin={mediaR2Origin(process.env)} />;
}
