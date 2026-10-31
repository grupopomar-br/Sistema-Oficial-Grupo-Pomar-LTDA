import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { parseEnvironment } from "../src/lib/config/environment.ts";
const release = process.argv.includes("--release");
const major = Number(process.versions.node.split(".")[0]);
if (major !== 24) {
  console.error("Use Node.js 24 LTS conforme .nvmrc.");
  process.exit(1);
}
const localEnv = existsSync(".env.local")
  ? parseEnv(readFileSync(".env.local", "utf8"))
  : {};
const env = { ...localEnv, ...process.env };
if (release) {
  try {
    parseEnvironment({ ...env, NODE_ENV: "production" });
    console.log(
      "Configuração de produção válida no formato. A conexão e o MFA precisam ser conferidos no projeto real.",
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else
  console.log(
    "Ambiente local pronto. npm run dev abre o espaço de desenvolvimento. Configure a nuvem conforme docs/CONFIGURACAO.md.",
  );
