import { PUBLIC_PATH, renderReportPage } from "@/lib/informe/html";

// Public ISO Survey page in English.
export function GET() {
  return renderReportPage("en", { abierto: false, pais: null, otherLanguageUrl: PUBLIC_PATH.es });
}
