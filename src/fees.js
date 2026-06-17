// Service fee-regels — moet gelijk blijven aan service_fee_for() in
// supabase/service-fee.sql (de database is de bron van waarheid bij betalen;
// dit is alleen voor weergave).
export const SERVICE_FEE_PCT = 0.08;
export const SERVICE_FEE_MIN = 5;

export function serviceFee(total) {
  return Math.max(Math.round(total * SERVICE_FEE_PCT * 100) / 100, SERVICE_FEE_MIN);
}
