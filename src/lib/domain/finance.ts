export type Receipt = {
  id: string;
  amountCents: number;
  receivedOn: string | null;
  status: "confirmed" | "voided";
};

function validMonth(value: string): boolean {
  return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validDate(value: string): boolean {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function positiveCents(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(
      "Recebimento deve ter valor positivo em centavos inteiros.",
    );
}

function checkedSum(a: number, b: number): number {
  const total = a + b;
  if (!Number.isSafeInteger(total))
    throw new RangeError("Total excede o limite seguro de centavos.");
  return total;
}

export function parseBRL(value: string): number {
  const normalized = value.trim().replace(/^R\$\s*/, "");
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{2})?$/.test(normalized))
    throw new RangeError("Valor monetário inválido.");
  const [reais, fraction = "00"] = normalized.replaceAll(".", "").split(",");
  const cents = BigInt(reais) * 100n + BigInt(fraction);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError("Valor excede o limite seguro de centavos.");
  return Number(cents);
}

// Não inclui contratos, parcelas previstas ou agregados antigos nos recebimentos.
// Datas são datas civis já convertidas para o fuso de negócio na camada de entrada.
export function summarizeReceipts(receipts: readonly Receipt[], month: string) {
  if (!validMonth(month)) throw new RangeError("Mês inválido; usar AAAA-MM.");
  const seen = new Set<string>();
  let receivedInMonthCents = 0;
  let undatedReceivedCents = 0;
  let totalReceivedCents = 0;
  for (const receipt of receipts) {
    if (!receipt.id.trim() || seen.has(receipt.id))
      throw new RangeError("ID de recebimento vazio ou duplicado.");
    seen.add(receipt.id);
    positiveCents(receipt.amountCents);
    if (receipt.status !== "confirmed" && receipt.status !== "voided")
      throw new RangeError("Estado de recebimento inválido.");
    if (receipt.receivedOn !== null && !validDate(receipt.receivedOn))
      throw new RangeError("Data de recebimento inválida.");
    if (receipt.status === "voided") continue;
    totalReceivedCents = checkedSum(totalReceivedCents, receipt.amountCents);
    if (receipt.receivedOn === null)
      undatedReceivedCents = checkedSum(
        undatedReceivedCents,
        receipt.amountCents,
      );
    else if (receipt.receivedOn.slice(0, 7) === month)
      receivedInMonthCents = checkedSum(
        receivedInMonthCents,
        receipt.amountCents,
      );
  }
  return { receivedInMonthCents, undatedReceivedCents, totalReceivedCents };
}
