const crypto = require("node:crypto");
const path = require("node:path");
const readline = require("node:readline/promises");
const mysql = require("mysql2/promise");

loadEnv(path.join(__dirname, "..", ".env"));

const config = {
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "customer_credit",
  },
};

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("");
    console.log("Create enterprise account");
    console.log("");
    const name = requiredString(await rl.question("Enterprise name: "), "Enterprise name");
    const suggestedCode = normalizeEnterpriseCode(name);
    const codeAnswer = await rl.question(`Enterprise code (${suggestedCode}): `);
    const code = normalizeEnterpriseCode(codeAnswer || suggestedCode);
    const usernameAnswer = await rl.question("Owner username (owner): ");
    const username = normalizeUsername(usernameAnswer || "owner");
    const password = requiredString(await rl.question("Owner password: "), "Owner password");

    const connection = await mysql.createConnection({
      ...config.db,
      decimalNumbers: true,
      dateStrings: true,
    });

    try {
      await ensureEnterpriseTables(connection);
      const enterpriseId = `ent-${crypto.createHash("sha256").update(code).digest("hex").slice(0, 18)}`;
      const userId = `usr-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")}`;
      const passwordHash = await hashPassword(password);

      await connection.beginTransaction();
      await connection.query(
        `
          INSERT INTO customer_credit_enterprises (id, code, name, status)
          VALUES (?, ?, ?, 'active')
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            status = 'active'
        `,
        [enterpriseId, code, name],
      );
      await connection.query(
        `
          INSERT INTO customer_credit_users
            (id, enterprise_id, username, display_name, role, password_hash)
          VALUES (?, ?, ?, ?, 'owner', ?)
          ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            role = 'owner',
            password_hash = VALUES(password_hash)
        `,
        [userId, enterpriseId, username, "Owner", passwordHash],
      );
      await connection.commit();

      console.log("");
      console.log("Enterprise ready.");
      console.log(`Login address: ${process.env.PUBLIC_ORIGIN || "http://127.0.0.1:5500"}/login`);
      console.log(`Enterprise code: ${code}`);
      console.log(`Username: ${username}`);
      console.log("");
      console.log("Keep the password private.");
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // No active transaction.
      }
      throw error;
    } finally {
      await connection.end();
    }
  } finally {
    rl.close();
  }
}

async function ensureEnterpriseTables(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_enterprises (
      id VARCHAR(64) PRIMARY KEY,
      code VARCHAR(80) NOT NULL,
      name VARCHAR(160) NOT NULL,
      status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_customer_credit_enterprise_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_users (
      id VARCHAR(64) PRIMARY KEY,
      enterprise_id VARCHAR(64) NOT NULL,
      username VARCHAR(80) NOT NULL,
      display_name VARCHAR(160) NOT NULL,
      role ENUM('owner', 'staff', 'viewer') NOT NULL DEFAULT 'owner',
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_customer_credit_user_enterprise_username (enterprise_id, username),
      INDEX idx_customer_credit_users_enterprise (enterprise_id),
      CONSTRAINT fk_customer_credit_users_enterprise
        FOREIGN KEY (enterprise_id) REFERENCES customer_credit_enterprises(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function requiredString(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text.slice(0, 160);
}

function normalizeEnterpriseCode(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (code || "main").slice(0, 80);
}

function normalizeUsername(value) {
  const username = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "");
  return (username || "owner").slice(0, 80);
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const iterations = 210000;
    const salt = crypto.randomBytes(16).toString("base64url");
    crypto.pbkdf2(String(password), salt, iterations, 32, "sha256", (error, derivedKey) => {
      if (error) reject(error);
      else resolve(`pbkdf2_sha256$${iterations}$${salt}$${derivedKey.toString("base64url")}`);
    });
  });
}

function loadEnv(filePath) {
  try {
    const content = require("node:fs").readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (key) process.env[key] = value;
    }
  } catch {
    // .env is optional here too.
  }
}

main().catch((error) => {
  console.error("");
  console.error(error.message || error);
  process.exit(1);
});
