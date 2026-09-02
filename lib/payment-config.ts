import "server-only";

export type TransferAccount = {
  bank: string;
  holder: string;
  account: string;
  kind: string;
};

/**
 * A transferência só é oferecida quando existe ao menos uma conta real no
 * ambiente. Assim nenhum número de exemplo pode chegar ao cliente.
 */
export function getTransferAccounts(): TransferAccount[] {
  const holder = process.env.PAYMENT_ACCOUNT_HOLDER?.trim() || "Tortas Fanor";
  const accounts: TransferAccount[] = [];

  const wallet = process.env.PAYMENT_YAPE_PLIN_NUMBER?.trim();
  if (wallet) {
    accounts.push({ bank: "Yape / Plin", holder, account: wallet, kind: "Celular" });
  }

  const bcp = process.env.PAYMENT_BCP_ACCOUNT?.trim();
  if (bcp) {
    accounts.push({ bank: "BCP", holder, account: bcp, kind: "Cuenta en soles" });
  }

  const interbank = process.env.PAYMENT_INTERBANK_ACCOUNT?.trim();
  if (interbank) {
    accounts.push({ bank: "Interbank", holder, account: interbank, kind: "Cuenta en soles" });
  }

  return accounts;
}

export function isTransferEnabled() {
  return getTransferAccounts().length > 0;
}
