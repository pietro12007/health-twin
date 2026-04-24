import { generatePatient } from "@/lib/patient";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(generatePatient());
}
