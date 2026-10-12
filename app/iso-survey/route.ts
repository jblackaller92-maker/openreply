import { PUBLIC_PATH, renderReportPage } from "@/lib/informe/html";

// Public ISO Survey page in Spanish: the door where people leave their email.
export function GET() {
  return renderReportPage("es", { abierto: false, pais: null, otherLanguageUrl: PUBLIC_PATH.en });
}
