import { NextResponse } from "next/server";
import { mockSessions, mockFilterOptions } from "@/lib/mock-data";

// This API route serves schedule data
// In production, this would proxy to the Python Lark API
// For now, it returns mock data for development

export async function GET() {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  // In production, you would:
  // 1. Call the Python API if PYTHON_API_URL is set
  // 2. Or directly call Lark API using environment variables:
  //    - LARK_APP_ID
  //    - LARK_APP_SECRET
  //    - LARK_BASE_TOKEN
  //    - LARK_TABLE_ID

  const pythonApiUrl = process.env.PYTHON_API_URL;

  if (pythonApiUrl) {
    try {
      const res = await fetch(`${pythonApiUrl}/api/schedule`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`Python API error: ${res.status}`);
      }

      const data = await res.json();
      return NextResponse.json(data);
    } catch {
      console.error("Failed to fetch from Python API, falling back to mock data");
    }
  }

  // Return mock data
  return NextResponse.json({
    sessions: mockSessions,
    filterOptions: mockFilterOptions,
    lastUpdated: new Date().toISOString(),
  });
}
