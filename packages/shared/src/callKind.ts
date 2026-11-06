/**
 * What a call is for (§4.6). A consultation is with a client: it is invoiced
 * and everyone is paid for it. A network call is an Expert's call with an expert
 * network's associate: nobody is paid, so it ends at Finished and has no money.
 */
export const CALL_KINDS = ['consultation', 'network'] as const;
export type CallKind = (typeof CALL_KINDS)[number];

export const CALL_KIND_LABELS: Record<CallKind, string> = {
  consultation: 'Client consultation',
  network: 'Network associate call',
};

/** Short form, for chips and table cells. */
export const CALL_KIND_SHORT: Record<CallKind, string> = {
  consultation: 'Consultation',
  network: 'Network call',
};

/** Nobody is paid for it: no invoice, no rate, no pay. */
export const isUnpaidKind = (kind: CallKind | null | undefined) => kind === 'network';
