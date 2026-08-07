const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const { promisify } = require("node:util");

const pbkdf2 = promisify(crypto.pbkdf2);

async function hashPassword(password) {
  const iterations = 210000;
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = await pbkdf2(password, salt, iterations, 32, "sha256");
  return `pbkdf2_sha256$${iterations}$${salt}$${key.toString("base64url")}`;
}

async function main() {
  const enterpriseCode = String(process.argv[2] || "").trim().toLowerCase();
  if (!enterpriseCode) throw new Error("Enterprise code is required");
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    const [owners] = await connection.query(`SELECT u.id,u.username,u.enterprise_id AS enterpriseId
      FROM customer_credit_users u JOIN customer_credit_enterprises e ON e.id=u.enterprise_id
      WHERE e.code=? AND u.role='owner' ORDER BY u.created_at LIMIT 1`, [enterpriseCode]);
    if (!owners.length) throw new Error(`No Owner account found for ${enterpriseCode}`);
    const owner = owners[0];
    const temporaryPassword = `Owner${crypto.randomBytes(6).toString("base64url")}7`;
    await connection.beginTransaction();
    await connection.query(`UPDATE customer_credit_users SET password_hash=?,must_change_password=1,
      employment_status='active',session_version=session_version+1 WHERE id=? AND enterprise_id=?`,
    [await hashPassword(temporaryPassword), owner.id, owner.enterpriseId]);
    await connection.query(`INSERT INTO customer_credit_audit_log
      (id,enterprise_id,user_id,username,action,entity_type,entity_id,summary)
      VALUES (?,?,?,?,?,?,?,?)`, [crypto.randomUUID(),owner.enterpriseId,owner.id,owner.username,
      "account.owner_access_reset","user",owner.id,"Owner access reset through authorized recovery"]);
    await connection.commit();
    console.log(JSON.stringify({ enterpriseCode, username: owner.username, temporaryPassword }));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
