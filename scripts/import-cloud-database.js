const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");

async function main() {
  const dumpPath = process.argv[2];
  if (!dumpPath) {
    throw new Error("Usage: node scripts/import-cloud-database.js <dump-file>");
  }

  const connection = await mysql.createConnection({
    host: requiredEnv("CLOUD_DB_HOST"),
    port: Number(requiredEnv("CLOUD_DB_PORT")),
    user: requiredEnv("CLOUD_DB_USER"),
    password: requiredEnv("CLOUD_DB_PASSWORD"),
    database: requiredEnv("CLOUD_DB_NAME"),
    multipleStatements: true,
  });

  try {
    const sql = await fs.readFile(path.resolve(dumpPath), "utf8");
    await connection.query(sql);

    const [counts] = await connection.query(`
      SELECT 'enterprises' AS table_name, COUNT(*) AS row_count
      FROM customer_credit_enterprises
      UNION ALL
      SELECT 'users', COUNT(*)
      FROM customer_credit_users
      UNION ALL
      SELECT 'records', COUNT(*)
      FROM customer_credit_records
      UNION ALL
      SELECT 'vendor_tracking', COUNT(*)
      FROM customer_credit_vendor_tracking
      UNION ALL
      SELECT 'meat_orders', COUNT(*)
      FROM customer_credit_meat_orders
      UNION ALL
      SELECT 'finance_entries', COUNT(*)
      FROM customer_credit_finance_entries
      UNION ALL
      SELECT 'payments', COUNT(*)
      FROM customer_credit_payments
      UNION ALL
      SELECT 'signup_invites', COUNT(*)
      FROM customer_credit_signup_invites
      UNION ALL
      SELECT 'audit_log', COUNT(*)
      FROM customer_credit_audit_log
      UNION ALL
      SELECT 'password_reset_tokens', COUNT(*)
      FROM customer_credit_password_reset_tokens
      UNION ALL
      SELECT 'email_verification_tokens', COUNT(*)
      FROM customer_credit_email_verification_tokens
    `);

    console.log(JSON.stringify(counts));
  } finally {
    await connection.end();
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
