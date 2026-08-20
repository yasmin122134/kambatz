import { NextResponse } from "next/server";
import { getFairnessRules } from "@/lib/fairness";

export async function GET() {
  try {
    const rules = await getFairnessRules();
    return NextResponse.json({ rules });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
