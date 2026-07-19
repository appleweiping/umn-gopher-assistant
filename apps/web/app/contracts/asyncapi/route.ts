import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  const contract = await readFile(path.resolve(process.cwd(), "../../asyncapi/asyncapi.yaml"), "utf8");
  return new Response(contract, {
    headers: {
      "Content-Disposition": "inline; filename=asyncapi.yaml",
      "Content-Type": "application/yaml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
