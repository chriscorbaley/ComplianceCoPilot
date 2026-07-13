-- Fix 2 — Day-by-day trip schedule for lodging deductibility.
-- Stores the per-day designation (business / personal / travel) chosen on the
-- Log Trip screen plus the derived night counts. A night is deductible when
-- (1) its following day is a business or travel day, OR (2) the following day is
-- personal but the day after that is a business day (a personal day sandwiched
-- between business days does not break deductibility — the taxpayer must remain
-- at the destination). A personal day at the end, before the return travel day,
-- makes the night before it non-deductible.
--
-- Shape:
-- {
--   "days": [
--     {"date": "2025-11-20", "type": "travel"},
--     {"date": "2025-11-21", "type": "business"},
--     {"date": "2025-11-22", "type": "personal"},
--     {"date": "2025-11-23", "type": "business"},
--     {"date": "2025-11-24", "type": "travel"}
--   ],
--   "deductible_nights": 3,
--   "total_nights": 4
-- }

ALTER TABLE public.business_trips
ADD COLUMN IF NOT EXISTS day_schedule jsonb;
