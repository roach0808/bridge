/** How a bank is named everywhere: its nickname, or its bank name and the account's last four digits. */
export function bankLabel(bank: { nickname: string | null; bankName: string } & ({ accountNumber: string } | { accountLast4: string })): string {
  if (bank.nickname) return bank.nickname;
  const last4 = 'accountLast4' in bank ? bank.accountLast4 : bank.accountNumber.replace(/\s/g, '').slice(-4);
  return `${bank.bankName} ··${last4}`;
}
