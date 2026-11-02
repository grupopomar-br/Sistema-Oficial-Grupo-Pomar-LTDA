import Image from "next/image";

export function BrandLogo({
  theme = "light",
  className = "",
}: {
  theme?: "light" | "dark";
  className?: string;
}) {
  return (
    <span className={`brand-wordmark ${className}`}>
      <Image
        src={
          theme === "dark"
            ? "/brand/grupo-pomar-escuro.png"
            : "/brand/grupo-pomar-claro.png"
        }
        alt="Grupo Pomar"
        width={2048}
        height={682}
        sizes="(max-width: 600px) 170px, 210px"
      />
    </span>
  );
}
