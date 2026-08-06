const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { gunzip } = require("node:zlib");
const {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const mysql = require("mysql2/promise");

loadEnv(path.join(__dirname, "..", ".env"));

const gunzipAsync = promisify(gunzip);
const prefix = "customer-credit/";
const tableDefinitions = [
  {
    name: "customer_credit_enterprises",
    columns: ["id", "code", "name", "status", "created_at", "updated_at"],
  },
  {
    name: "customer_credit_users",
    columns: [
      "id",
      "enterprise_id",
      "username",
      "display_name",
      "role",
      "password_hash",
      "must_change_password",
      "session_version",
      "email",
      "email_verified_at",
      "employee_number",
      "phone",
      "employment_status",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "customer_credit_time_entries",
    columns: ["id", "enterprise_id", "user_id", "clock_in", "clock_out", "paid_at", "paid_by",
      "adjusted_by", "adjustment_reason", "created_at", "updated_at"],
  },
  {
    name: "customer_credit_registered_devices",
    columns: ["id", "enterprise_id", "device_name", "token_hash", "status", "registered_by",
      "last_used_at", "created_at", "updated_at"],
  },
  {
    name: "customer_credit_products",
    columns: [
      "id",
      "enterprise_id",
      "name",
      "price",
      "barcode",
      "quantity",
      "label_size",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "customer_credit_vendor_accounts",
    columns: [
      "id", "enterprise_id", "vendor_name", "phone", "phone_normalized", "email",
      "email_normalized", "password_hash", "session_version", "status", "created_at", "updated_at",
    ],
  },
  {
    name: "customer_credit_vendor_tracking",
    columns: [
      "id",
      "enterprise_id",
      "vendor_account_id",
      "vendor_name",
      "contact_name",
      "quantity",
      "unit",
      "received_quantity",
      "spoiled_quantity",
      "accepted_quantity",
      "returned_quantity",
      "phone",
      "email",
      "reference",
      "amount",
      "due_date",
      "status",
      "note",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "customer_credit_vendor_spoilage_history",
    columns: [
      "id", "enterprise_id", "receiving_id", "vendor_name", "product", "received_quantity",
      "spoilage_quantity", "accepted_quantity", "note", "recorded_by", "receiving_created_at", "recorded_at",
    ],
  },
  {
    name: "customer_credit_meat_orders",
    columns: [
      "id",
      "enterprise_id",
      "customer_name",
      "customer_phone",
      "meat_type",
      "quantity",
      "preparation_instructions",
      "pickup_at",
      "employee_name",
      "created_at",
    ],
  },
  {
    name: "customer_credit_finance_entries",
    columns: [
      "id", "enterprise_id", "entry_type", "amount", "category", "payment_method",
      "entry_date", "notes", "receipt_name", "receipt_type", "receipt_data",
      "created_at", "updated_at",
    ],
  },
  {
    name: "customer_credit_records",
    columns: [
      "id",
      "enterprise_id",
      "customer_name",
      "customer_phone",
      "item_note",
      "credit_date",
      "credit_time",
      "credit_amount",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "customer_credit_payments",
    columns: [
      "id",
      "record_id",
      "payment_date",
      "payment_time",
      "amount",
      "note",
      "created_at",
    ],
  },
  {
    name: "customer_credit_signup_invites",
    columns: [
      "id",
      "code_hash",
      "created_by_user_id",
      "created_by_enterprise_id",
      "expires_at",
      "used_at",
      "used_by_enterprise_id",
      "created_at",
    ],
  },
  {
    name: "customer_credit_audit_log",
    columns: [
      "id",
      "enterprise_id",
      "user_id",
      "username",
      "action",
      "entity_type",
      "entity_id",
      "summary",
      "created_at",
    ],
  },
  {
    name: "customer_credit_password_reset_tokens",
    columns: [
      "id",
      "user_id",
      "enterprise_id",
      "token_hash",
      "expires_at",
      "used_at",
      "created_at",
    ],
  },
  {
    name: "customer_credit_email_verification_tokens",
    columns: [
      "id",
      "user_id",
      "enterprise_id",
      "email",
      "token_hash",
      "expires_at",
      "used_at",
      "created_at",
    ],
  },
];

main().catch((error) => {
  console.error(`Restore failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  if (process.env.RESTORE_CONFIRM !== "YES") {
    throw new Error("Set RESTORE_CONFIRM=YES only when you intend to replace the current database.");
  }

  const required = [
    "DB_HOST",
    "DB_USER",
    "DB_NAME",
    "BACKUP_S3_ENDPOINT",
    "BACKUP_S3_BUCKET",
    "BACKUP_S3_ACCESS_KEY_ID",
    "BACKUP_S3_SECRET_ACCESS_KEY",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing settings: ${missing.join(", ")}`);
  }

  const backupClient = new S3Client({
    endpoint: process.env.BACKUP_S3_ENDPOINT,
    region: process.env.BACKUP_S3_REGION || "auto",
    forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY,
    },
  });

  const requestedKey = process.argv[2];
  const key = requestedKey || (await findLatestBackupKey(backupClient));
  if (!key || !key.startsWith(prefix)) {
    throw new Error("No valid customer-credit backup was found.");
  }

  const response = await backupClient.send(
    new GetObjectCommand({
      Bucket: process.env.BACKUP_S3_BUCKET,
      Key: key,
    }),
  );
  const compressed = Buffer.from(await response.Body.transformToByteArray());
  const backup = JSON.parse((await gunzipAsync(compressed)).toString("utf8"));
  validateBackup(backup);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });

  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM customer_credit_email_verification_tokens");
    await connection.query("DELETE FROM customer_credit_password_reset_tokens");
    await connection.query("DELETE FROM customer_credit_audit_log");
    await connection.query("DELETE FROM customer_credit_signup_invites");
    await connection.query("DELETE FROM customer_credit_payments");
    await connection.query("DELETE FROM customer_credit_records");
    await connection.query("DELETE FROM customer_credit_meat_orders");
    await connection.query("DELETE FROM customer_credit_finance_entries");
    await connection.query("DELETE FROM customer_credit_vendor_spoilage_history");
    await connection.query("DELETE FROM customer_credit_vendor_tracking");
    await connection.query("DELETE FROM customer_credit_vendor_accounts");
    await connection.query("DELETE FROM customer_credit_products");
    await connection.query("DELETE FROM customer_credit_registered_devices");
    await connection.query("DELETE FROM customer_credit_time_entries");
    await connection.query("DELETE FROM customer_credit_users");
    await connection.query("DELETE FROM customer_credit_enterprises");

    for (const table of tableDefinitions) {
      await insertRows(connection, table, backup.tables[table.name]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }

  console.log(`Restore completed from ${key}.`);
  for (const table of tableDefinitions) {
    console.log(`${table.name}: ${backup.tables[table.name].length} row(s)`);
  }
}

async function findLatestBackupKey(client) {
  let continuationToken;
  let latest;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: process.env.BACKUP_S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of response.Contents || []) {
      if (!latest || new Date(item.LastModified) > new Date(latest.LastModified)) {
        latest = item;
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return latest?.Key;
}

function validateBackup(backup) {
  if (!backup || backup.schemaVersion !== 1 || !backup.tables) {
    throw new Error("The selected file is not a supported customer-credit backup.");
  }
  for (const table of tableDefinitions) {
    if (
      table.name === "customer_credit_products" &&
      !Array.isArray(backup.tables[table.name])
    ) {
      backup.tables[table.name] = [];
    }
    if (
      table.name === "customer_credit_vendor_tracking" &&
      !Array.isArray(backup.tables[table.name])
    ) {
      backup.tables[table.name] = [];
    }
    if (
      table.name === "customer_credit_meat_orders" &&
      !Array.isArray(backup.tables[table.name])
    ) {
      backup.tables[table.name] = [];
    }
    if (
      table.name === "customer_credit_finance_entries" &&
      !Array.isArray(backup.tables[table.name])
    ) {
      backup.tables[table.name] = [];
    }
    if (
      table.name === "customer_credit_signup_invites" &&
      !Array.isArray(backup.tables[table.name])
    ) {
      backup.tables[table.name] = [];
    }
    if (
      table.name === "customer_credit_audit_log" &&
      !Array.isArray(backup.tables[table.name])
    ) {
      backup.tables[table.name] = [];
    }
    if (
      ["customer_credit_password_reset_tokens", "customer_credit_email_verification_tokens"].includes(
        table.name,
      ) &&
      !Array.isArray(backup.tables[table.name])
    ) {
      backup.tables[table.name] = [];
    }
    if (["customer_credit_time_entries", "customer_credit_registered_devices"].includes(table.name)
        && !Array.isArray(backup.tables[table.name])) {
      backup.tables[table.name] = [];
    }
    if (!Array.isArray(backup.tables[table.name])) {
      throw new Error(`Backup table is missing or invalid: ${table.name}`);
    }
  }
}

async function insertRows(connection, table, rows) {
  const batchSize = 200;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const rowPlaceholders = `(${table.columns.map(() => "?").join(", ")})`;
    const placeholders = batch.map(() => rowPlaceholders).join(", ");
    const values = batch.flatMap((row) =>
      table.columns.map((column) =>
        column === "must_change_password"
          ? row[column] ?? 0
          : column === "session_version"
            ? row[column] ?? 1
            : column === "quantity"
              ? row[column] ?? 1
              : ["received_quantity", "spoiled_quantity"].includes(column)
                ? row[column] ?? 0
              : column === "amount"
                ? row[column] ?? 0
                : column === "status"
                  ? row[column] ?? "ordered"
            : row[column] ?? null,
      ),
    );
    await connection.query(
      `INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES ${placeholders}`,
      values,
    );
  }
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 1) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
