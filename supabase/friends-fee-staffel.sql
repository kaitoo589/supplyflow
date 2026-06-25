-- ============================================================
-- SupplyFlow — Flowva Friends fee-staffel bijwerken
-- Voer uit in: Supabase -> SQL Editor -> New query -> plak -> Run.
--
-- Nieuwe, vastgezette staffel (2026-06-25): zachtere daling dan
-- voorheen = gezondere marge, nog steeds duidelijke groepskorting.
--   1 (solo) 8% / €5   ·   2  7% / €4,50   ·   3  6% / €4,50
--   4  5,5% / €4       ·   5  5% / €4       ·   6  4,5% / €4
--   7+ 4% / €3,50
-- ============================================================

create or replace function public.ff_member_fee(p_size int, p_total numeric)
returns numeric language sql immutable as $$
  select case
    when p_size >= 7 then greatest(round(coalesce(p_total, 0) * 0.040, 2), 3.50)
    when p_size  = 6 then greatest(round(coalesce(p_total, 0) * 0.045, 2), 4.00)
    when p_size  = 5 then greatest(round(coalesce(p_total, 0) * 0.050, 2), 4.00)
    when p_size  = 4 then greatest(round(coalesce(p_total, 0) * 0.055, 2), 4.00)
    when p_size  = 3 then greatest(round(coalesce(p_total, 0) * 0.060, 2), 4.50)
    when p_size  = 2 then greatest(round(coalesce(p_total, 0) * 0.070, 2), 4.50)
    else                  greatest(round(coalesce(p_total, 0) * 0.080, 2), 5.00)  -- 1 = solo-tarief
  end;
$$;
