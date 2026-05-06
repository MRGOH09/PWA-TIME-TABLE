"use client";

import useSWR from "swr";
import { Session } from "@/lib/types";

interface ScheduleData {
  sessions: Session[];
  filterOptions: {
    branches: string[];
    levels: string[];
    days: string[];
    subjects: string[];
    grades: string[];
    teachers: string[];
    months: string[];
  };
  lastUpdated: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useScheduleData() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<ScheduleData>(
    "/api/schedule",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 minute
    }
  );

  return {
    sessions: data?.sessions ?? [],
    filterOptions: data?.filterOptions ?? {
      branches: [],
      levels: [],
      days: [],
      subjects: [],
      grades: [],
      teachers: [],
      months: [],
    },
    lastUpdated: data?.lastUpdated
      ? new Date(data.lastUpdated).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : undefined,
    isLoading,
    isRefreshing: isValidating,
    error,
    refresh: () => mutate(),
  };
}
