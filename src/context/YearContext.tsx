import React, { createContext, useContext, useMemo, useState } from 'react';

// Global tax-year selection. Lets clients view and log data for prior tax years
// throughout the app (Hours, Mileage, Documents, Business Travel history,
// Minutes). Defaults to the current calendar year; options are the current year
// and the three prior years. The Dashboard intentionally ignores this and always
// shows current-year data.

const CURRENT_YEAR = new Date().getFullYear();

// Current year + 3 prior, newest first (e.g. in 2026: [2026, 2025, 2024, 2023]).
export const YEAR_OPTIONS: number[] = [0, 1, 2, 3].map((i) => CURRENT_YEAR - i);

export interface YearState {
  year: number;
  setYear: (y: number) => void;
  currentYear: number;
  isCurrentYear: boolean;
  options: number[];
  // Convenience ISO range for `activity_date`/`created_at` BETWEEN filters.
  startIso: string;
  endIso: string;
}

const YearContext = createContext<YearState | null>(null);

export const YearProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [year, setYear] = useState<number>(CURRENT_YEAR);

  const value = useMemo<YearState>(
    () => ({
      year,
      setYear,
      currentYear: CURRENT_YEAR,
      isCurrentYear: year === CURRENT_YEAR,
      options: YEAR_OPTIONS,
      startIso: `${year}-01-01`,
      endIso: `${year}-12-31`,
    }),
    [year],
  );

  return <YearContext.Provider value={value}>{children}</YearContext.Provider>;
};

export function useYear(): YearState {
  const ctx = useContext(YearContext);
  if (!ctx) throw new Error('useYear must be used inside YearProvider');
  return ctx;
}
