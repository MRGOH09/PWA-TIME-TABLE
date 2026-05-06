"use client";

import { useState, useCallback, useMemo } from "react";
import { FilterState, Session } from "@/lib/types";
import { filterSessions } from "@/lib/data-utils";

const initialFilters: FilterState = {
  branch: [],
  level: [],
  day: [],
  subject: [],
  grade: [],
  teacher: [],
  month: [],
  attendance: [],
};

export function useFilters(sessions: Session[]) {
  const [filters, setFilters] = useState<FilterState>(initialFilters);

  const updateFilter = useCallback(
    (key: keyof FilterState, values: string[]) => {
      setFilters((prev) => ({
        ...prev,
        [key]: values,
      }));
    },
    []
  );

  const clearAll = useCallback(() => {
    setFilters(initialFilters);
  }, []);

  const filteredSessions = useMemo(
    () => filterSessions(sessions, filters),
    [sessions, filters]
  );

  return {
    filters,
    filteredSessions,
    updateFilter,
    clearAll,
  };
}
