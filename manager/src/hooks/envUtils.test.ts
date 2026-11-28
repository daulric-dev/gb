import { describe, expect, test } from "bun:test";
import { parseRawEnvText, isSecretKey } from "./envUtils";

describe("envUtils - parseRawEnvText", () => {
  test("parses standard key=value pairs", () => {
    const raw = `
PORT=3001
NODE_ENV=production
FRONTEND_URL=http://localhost:3000
`;
    const parsed = parseRawEnvText(raw);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({
      key: "PORT",
      value: "3001",
      is_secret: false,
      comment: undefined,
    });
    expect(parsed[1].key).toBe("NODE_ENV");
    expect(parsed[1].value).toBe("production");
    expect(parsed[2].key).toBe("FRONTEND_URL");
    expect(parsed[2].value).toBe("http://localhost:3000");
  });

  test("handles export prefix and surrounding quotes", () => {
    const raw = `
export DATABASE_URL="file:./prisma/gradebook.db"
export AUTH_SECRET='my-super-secret-key-12345'
`;
    const parsed = parseRawEnvText(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].key).toBe("DATABASE_URL");
    expect(parsed[0].value).toBe("file:./prisma/gradebook.db");
    expect(parsed[1].key).toBe("AUTH_SECRET");
    expect(parsed[1].value).toBe("my-super-secret-key-12345");
    expect(parsed[1].is_secret).toBe(true);
  });

  test("handles inline and preceding comments", () => {
    const raw = `
# Server Configuration
PORT=3005 # port for backend
# Database location
DATABASE_URL=file:./gradebook.db
`;
    const parsed = parseRawEnvText(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].key).toBe("PORT");
    expect(parsed[0].value).toBe("3005");
    expect(parsed[0].comment).toBe("port for backend");

    expect(parsed[1].key).toBe("DATABASE_URL");
    expect(parsed[1].value).toBe("file:./gradebook.db");
    expect(parsed[1].comment).toBe("Database location");
  });

  test("correctly tags secret keys", () => {
    expect(isSecretKey("AUTH_SECRET")).toBe(true);
    expect(isSecretKey("CHAT_ENCRYPTION_KEY")).toBe(true);
    expect(isSecretKey("STUDENT_CLAIM_CODE_PEPPER")).toBe(true);
    expect(isSecretKey("JWT_TOKEN")).toBe(true);
    expect(isSecretKey("SMTP_PASS")).toBe(true);
    expect(isSecretKey("PORT")).toBe(false);
  });
});
