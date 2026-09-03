/// <reference path="../deno.d.ts" />

type ImportRow = {
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  errors: string[];
};

const splitCsv = (line: string) =>
  line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (!request.headers.get("Authorization")?.startsWith("Bearer "))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.csv !== "string" || body.csv.length > 2_000_000)
    return Response.json(
      { error: "csv is required and must be below 2MB" },
      { status: 400 },
    );
  const lines = body.csv.split(/\r?\n/).filter((line: string) => line.trim());
  if (lines.length < 2)
    return Response.json(
      { error: "CSV must include a header and at least one row" },
      { status: 400 },
    );
  const headers = splitCsv(lines[0]).map((header) => header.toLowerCase());
  const firstNameIndex = headers.indexOf("first_name");
  const lastNameIndex = headers.indexOf("last_name");
  const emailIndex = headers.indexOf("email");
  const rows: ImportRow[] = lines
    .slice(1)
    .map((line: string, index: number) => {
      const values = splitCsv(line);
      const firstName = values[firstNameIndex] ?? "";
      const lastName = values[lastNameIndex] ?? "";
      const email = values[emailIndex] ?? "";
      const errors: string[] = [];
      if (firstNameIndex < 0 || !firstName)
        errors.push("first_name is required");
      if (lastNameIndex < 0 || !lastName) errors.push("last_name is required");
      if (emailIndex >= 0 && email && !/^\S+@\S+\.\S+$/.test(email))
        errors.push("email is invalid");
      return { row: index + 2, firstName, lastName, email, errors };
    });
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.email) continue;
    const key = row.email.toLowerCase();
    if (seen.has(key)) row.errors.push("duplicate email in import");
    seen.add(key);
  }
  return Response.json({
    total: rows.length,
    valid: rows.filter((row) => row.errors.length === 0).length,
    invalid: rows.filter((row) => row.errors.length > 0).length,
    rows,
  });
});
