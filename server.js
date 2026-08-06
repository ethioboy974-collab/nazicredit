const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { URL } = require("node:url");
const { gzip } = require("node:zlib");
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const mysql = require("mysql2/promise");
const { calculateAccepted } = require("./vendor-quantities");
const {
  calculateVendorPortalSummary,
  normalizeVendorEmail,
  normalizeVendorPhone,
} = require("./vendor-portal-security");
const { createOrderNotificationService } = require("./order-notification-service");
const {
  canResendOrderNotification,
  canTransitionOrderStatus,
  isOrderStatus,
} = require("./order-workflow");

loadEnv(path.join(__dirname, ".env"));

const gzipAsync = promisify(gzip);
const MAX_PRODUCT_QUANTITY = 30;
const MAX_VENDOR_QUANTITY = 9999;

const config = {
  port: Number(process.env.PORT || 5500),
  host: process.env.HOST || "127.0.0.1",
  publicOrigin: process.env.PUBLIC_ORIGIN || "",
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "customer_credit",
    autoCreate: process.env.DB_AUTO_CREATE !== "false",
  },
  auth: {
    storeName: process.env.STORE_NAME || "Main Store",
    defaultEnterpriseCode: normalizeEnterpriseCode(
      process.env.DEFAULT_ENTERPRISE_CODE || process.env.ENTERPRISE_CODE || process.env.STORE_NAME || "main",
    ),
    defaultUsername: normalizeUsername(process.env.DEFAULT_ENTERPRISE_USERNAME || "owner"),
    password: process.env.STORE_PASSWORD || "store1234",
    passwordHash: process.env.STORE_PASSWORD_HASH || "",
    sessionSecret:
      process.env.SESSION_SECRET || process.env.DB_PASSWORD || "change-this-session-secret",
    sessionHours: Number(process.env.SESSION_HOURS || 12),
    secureCookie:
      process.env.COOKIE_SECURE === "true" ||
      (process.env.PUBLIC_ORIGIN || "").toLowerCase().startsWith("https://"),
    maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 8),
    lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 10),
    maxSignupsPerHour: Number(process.env.MAX_SIGNUPS_PER_HOUR || 5),
    signupInviteDays: Number(process.env.SIGNUP_INVITE_DAYS || 7),
    ownerPin: String(process.env.OWNER_PIN || "2025"),
  },
  backup: {
    enabled: process.env.BACKUP_ENABLED === "true",
    endpoint: process.env.BACKUP_S3_ENDPOINT || "",
    region: process.env.BACKUP_S3_REGION || "auto",
    bucket: process.env.BACKUP_S3_BUCKET || "",
    accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY || "",
    forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE !== "false",
    intervalHours: Number(process.env.BACKUP_INTERVAL_HOURS || 24),
    retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 35),
  },
  email: {
    apiKey: process.env.RESEND_API_KEY || "",
    from: process.env.EMAIL_FROM || "Nazi Credit <security@nazicredit.com>",
    resetMinutes: Number(process.env.PASSWORD_RESET_MINUTES || 30),
    verifyHours: Number(process.env.EMAIL_VERIFY_HOURS || 24),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
    transcriptionModel: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe",
    summaryCacheMinutes: Number(process.env.AI_SUMMARY_CACHE_MINUTES || 15),
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

let pool;
let backupClient;
const loginAttempts = new Map();
const signupAttempts = new Map();
const recoveryAttempts = new Map();
const ownerPinUnlocks = new Map();
const aiSummaryCache = new Map();
const orderNotificationService = createOrderNotificationService({
  provider: process.env.ORDER_NOTIFICATION_PROVIDER || "log",
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  },
});

main().catch((error) => {
  if (error.code === "ECONNREFUSED") {
    console.error("Could not connect to MySQL.");
    console.error(`Start MySQL and confirm it is listening on ${config.db.host}:${config.db.port}.`);
    console.error("Then check your .env username and password.");
  } else if (error.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("MySQL rejected the username or password in .env.");
  } else {
    console.error(error);
  }
  process.exit(1);
});

async function main() {
  validateDatabaseName(config.db.database);
  await ensureDatabase();
  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    decimalNumbers: true,
    dateStrings: true,
  });
  await ensureSchema();
  initializeBackupScheduler();

  const server = http.createServer(handleRequest);
  globalThis.customerCreditServer = server;
  server.listen(config.port, config.host, () => {
    const localUrl = `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${config.port}`;
    console.log(`Customer Credit app: ${config.publicOrigin || localUrl}/index.html`);
    console.log(`MySQL database: ${config.db.database}`);
    console.log(`Default enterprise: ${config.auth.defaultEnterpriseCode}`);
  });
}

function initializeBackupScheduler() {
  if (!config.backup.enabled) {
    console.log("Cloud backups: disabled");
    return;
  }

  const missingValues = [
    ["BACKUP_S3_ENDPOINT", config.backup.endpoint],
    ["BACKUP_S3_BUCKET", config.backup.bucket],
    ["BACKUP_S3_ACCESS_KEY_ID", config.backup.accessKeyId],
    ["BACKUP_S3_SECRET_ACCESS_KEY", config.backup.secretAccessKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingValues.length) {
    throw new Error(`Cloud backups are enabled but these settings are missing: ${missingValues.join(", ")}`);
  }

  if (!Number.isFinite(config.backup.intervalHours) || config.backup.intervalHours <= 0) {
    throw new Error("BACKUP_INTERVAL_HOURS must be a positive number.");
  }
  if (!Number.isFinite(config.backup.retentionDays) || config.backup.retentionDays <= 0) {
    throw new Error("BACKUP_RETENTION_DAYS must be a positive number.");
  }

  backupClient = new S3Client({
    endpoint: config.backup.endpoint,
    region: config.backup.region,
    forcePathStyle: config.backup.forcePathStyle,
    credentials: {
      accessKeyId: config.backup.accessKeyId,
      secretAccessKey: config.backup.secretAccessKey,
    },
  });

  const runBackup = () => {
    createCloudBackup().catch((error) => {
      console.error(`Cloud backup failed: ${error.message}`);
    });
  };
  const firstBackupTimer = setTimeout(runBackup, 10_000);
  firstBackupTimer.unref();

  const intervalMs = config.backup.intervalHours * 60 * 60 * 1000;
  const backupTimer = setInterval(runBackup, intervalMs);
  backupTimer.unref();
  console.log(
    `Cloud backups: every ${config.backup.intervalHours} hours, retained for ${config.backup.retentionDays} days`,
  );
}

async function createCloudBackup() {
  const newestBackup = await findNewestCloudBackup();
  const duplicateWindowMs = Math.min(config.backup.intervalHours * 0.8, 20) * 60 * 60 * 1000;
  if (
    newestBackup?.LastModified &&
    Date.now() - new Date(newestBackup.LastModified).getTime() < duplicateWindowMs
  ) {
    console.log(`Cloud backup skipped: a recent backup already exists (${newestBackup.Key}).`);
    return;
  }

  const connection = await pool.getConnection();
  let tables;
  try {
    await connection.beginTransaction();
    tables = {
      customer_credit_enterprises: await selectBackupRows(
        connection,
        "customer_credit_enterprises",
      ),
      customer_credit_users: await selectBackupRows(connection, "customer_credit_users"),
      customer_credit_products: await selectBackupRows(connection, "customer_credit_products"),
      customer_credit_barcode_print_events: await selectBackupRows(
        connection,
        "customer_credit_barcode_print_events",
      ),
      customer_credit_vendor_tracking: await selectBackupRows(
        connection,
        "customer_credit_vendor_tracking",
      ),
      customer_credit_vendor_accounts: await selectBackupRows(
        connection,
        "customer_credit_vendor_accounts",
      ),
      customer_credit_vendor_spoilage_history: await selectBackupRows(
        connection,
        "customer_credit_vendor_spoilage_history",
      ),
      customer_credit_meat_orders: await selectBackupRows(
        connection,
        "customer_credit_meat_orders",
      ),
      customer_credit_meat_order_items: await selectBackupRows(connection, "customer_credit_meat_order_items"),
      customer_credit_finance_entries: await selectBackupRows(
        connection,
        "customer_credit_finance_entries",
      ),
      customer_credit_records: await selectBackupRows(connection, "customer_credit_records"),
      customer_credit_payments: await selectBackupRows(connection, "customer_credit_payments"),
      customer_credit_signup_invites: await selectBackupRows(
        connection,
        "customer_credit_signup_invites",
      ),
      customer_credit_audit_log: await selectBackupRows(
        connection,
        "customer_credit_audit_log",
      ),
      customer_credit_password_reset_tokens: await selectBackupRows(
        connection,
        "customer_credit_password_reset_tokens",
      ),
      customer_credit_email_verification_tokens: await selectBackupRows(
        connection,
        "customer_credit_email_verification_tokens",
      ),
    };
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const exportedAt = new Date();
  const backup = {
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    database: config.db.database,
    tables,
  };
  const body = await gzipAsync(Buffer.from(JSON.stringify(backup)), { level: 9 });
  const datePath = exportedAt.toISOString().slice(0, 10).replaceAll("-", "/");
  const timestamp = exportedAt.toISOString().replaceAll(":", "-");
  const key = `customer-credit/${datePath}/customer-credit-${timestamp}.json.gz`;

  await backupClient.send(
    new PutObjectCommand({
      Bucket: config.backup.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      ContentEncoding: "gzip",
      Metadata: { "schema-version": "1" },
    }),
  );

  await removeExpiredCloudBackups();
  console.log(
    `Cloud backup completed: ${key} (${tables.customer_credit_records.length} credit records, ${tables.customer_credit_payments.length} payments, ${tables.customer_credit_products.length} products, ${tables.customer_credit_vendor_tracking.length} vendors, ${tables.customer_credit_meat_orders.length} meat orders)`,
  );
}

async function selectBackupRows(connection, tableName) {
  const allowedTables = new Set([
    "customer_credit_enterprises",
    "customer_credit_users",
    "customer_credit_products",
    "customer_credit_barcode_print_events",
    "customer_credit_vendor_tracking",
    "customer_credit_email_verification_tokens",
  ]);
  if (!allowedTables.has(tableName)) {
    throw new Error("Invalid backup table.");
  }
  const [rows] = await connection.query(`SELECT * FROM ${tableName} ORDER BY id`);
  return rows;
}

async function findNewestCloudBackup() {
  const response = await backupClient.send(
    new ListObjectsV2Command({
      Bucket: config.backup.bucket,
      Prefix: "customer-credit/",
    }),
  );
  return (response.Contents || []).sort(
    (left, right) => new Date(right.LastModified) - new Date(left.LastModified),
  )[0];
}

async function removeExpiredCloudBackups() {
  const cutoff = Date.now() - config.backup.retentionDays * 24 * 60 * 60 * 1000;
  let continuationToken;

  do {
    const response = await backupClient.send(
      new ListObjectsV2Command({
        Bucket: config.backup.bucket,
        Prefix: "customer-credit/",
        ContinuationToken: continuationToken,
      }),
    );
    const expired = (response.Contents || [])
      .filter((item) => item.LastModified && new Date(item.LastModified).getTime() < cutoff)
      .map((item) => ({ Key: item.Key }));

    if (expired.length) {
      await backupClient.send(
        new DeleteObjectsCommand({
          Bucket: config.backup.bucket,
          Delete: { Objects: expired, Quiet: true },
        }),
      );
      console.log(`Cloud backup cleanup: removed ${expired.length} expired backup(s).`);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function handleRequest(request, response) {
  setCommonHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

  try {
    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      await pool.query("SELECT 1");
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/access-help") {
      sendAccessHelpPage(response);
      return;
    }

    if (requestUrl.pathname === "/forgot-password") {
      await handleForgotPasswordRequest(request, response);
      return;
    }

    if (requestUrl.pathname === "/reset-password") {
      await handleResetPasswordRequest(request, response, requestUrl);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/verify-email") {
      await handleVerifyEmailRequest(response, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/signup") {
      await handleSignupRequest(request, response);
      return;
    }

    if (requestUrl.pathname === "/login") {
      await handleLoginRequest(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/vendor-login") {
      await handleVendorLoginRequest(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/vendor-logout" || requestUrl.pathname === "/api/vendor-portal/logout") {
      clearVendorSession(response);
      if (requestUrl.pathname.startsWith("/api/")) sendJson(response, 200, { ok: true });
      else redirect(response, "/vendor-login");
      return;
    }

    if (requestUrl.pathname === "/vendor-portal" || requestUrl.pathname === "/vendor-portal.html"
        || requestUrl.pathname === "/vendor-portal.css" || requestUrl.pathname === "/vendor-portal.js"
        || requestUrl.pathname.startsWith("/api/vendor-portal/")) {
      const signedVendorSession = getVendorSession(request);
      const vendorSession = signedVendorSession ? await refreshVendorSessionAccess(signedVendorSession) : null;
      if (!vendorSession) {
        if (signedVendorSession) clearVendorSession(response);
        if (requestUrl.pathname.startsWith("/api/")) sendJson(response, 401, { ok: false, error: "Vendor login required" });
        else redirect(response, "/vendor-login");
        return;
      }
      if (requestUrl.pathname === "/api/vendor-portal/data" && request.method === "GET") {
        sendJson(response, 200, { ok: true, ...(await getVendorPortalData(vendorSession)) });
        return;
      }
      if (requestUrl.pathname === "/api/vendor-portal/change-password" && request.method === "POST") {
        const body = await readJsonBody(request);
        const sessionVersion = await changeVendorPassword(
          vendorSession,
          body.currentPassword,
          body.newPassword,
        );
        setVendorSession(response, { ...vendorSession, sessionVersion });
        sendJson(response, 200, { ok: true });
        return;
      }
      if (requestUrl.pathname.startsWith("/api/")) {
        sendJson(response, 405, { ok: false, error: "Vendor portal is read-only" });
        return;
      }
      if (requestUrl.pathname === "/vendor-portal") requestUrl.pathname = "/vendor-portal.html";
      await serveStaticFile(requestUrl, response);
      return;
    }

    if (requestUrl.pathname === "/api/logout") {
      clearSession(response);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (requestUrl.pathname === "/logout") {
      clearSession(response);
      redirect(response, "/login");
      return;
    }

    const signedSession = getSession(request);
    const session = signedSession ? await refreshSessionAccess(signedSession) : null;
    if (!session) {
      if (signedSession) clearSession(response);
      if (requestUrl.pathname.startsWith("/api/")) {
        sendJson(response, 401, { ok: false, error: "Login required" });
        return;
      }

      redirect(response, "/login");
      return;
    }

    if (requestUrl.pathname === "/admin" || requestUrl.pathname === "/admin.html") {
      redirect(response, "/index.html");
      return;
    }

    if (
      (requestUrl.pathname === "/finance-dashboard.html" || requestUrl.pathname === "/finance-dashboard")
      && session.role !== "owner"
    ) {
      redirect(response, "/index.html");
      return;
    }
    if (
      (requestUrl.pathname === "/ai-dashboard.html" || requestUrl.pathname === "/ai-dashboard")
      && session.role !== "owner"
    ) {
      redirect(response, "/index.html");
      return;
    }
    if (
      (requestUrl.pathname === "/ai-dashboard.html" || requestUrl.pathname === "/ai-dashboard")
      && !hasOwnerPinAccess(session)
    ) {
      redirect(response, `/owner-pin.html?next=${encodeURIComponent("/ai-dashboard.html")}`);
      return;
    }
    if (
      (requestUrl.pathname === "/finance-dashboard.html" || requestUrl.pathname === "/finance-dashboard")
      && !hasOwnerPinAccess(session)
    ) {
      redirect(response, `/owner-pin.html?next=${encodeURIComponent("/finance-dashboard.html")}`);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApiRequest(request, response, requestUrl, session);
      return;
    }

    await serveStaticFile(requestUrl, response);
  } catch (error) {
    console.error(error);
    if (error.statusCode) {
      sendJson(response, error.statusCode, { ok: false, error: error.message });
      return;
    }
    sendJson(response, 500, { ok: false, error: "Server error" });
  }
}

async function handleLoginRequest(request, response, requestUrl) {
  if (request.method === "GET") {
    const signedSession = getSession(request);
    if (signedSession && (await refreshSessionAccess(signedSession))) {
      redirect(response, "/index.html");
      return;
    }
    if (signedSession) clearSession(response);
    sendLoginPage(
      response,
      "",
      {
        enterpriseCode: requestUrl.searchParams.get("enterprise") || undefined,
        username: requestUrl.searchParams.get("username") || undefined,
      },
      requestUrl.searchParams.get("created") === "1"
        ? "Account created successfully. Sign in to open your new ledger."
        : "",
    );
    return;
  }

  if (request.method !== "POST") {
    sendLoginPage(response, "Use the login form to continue.");
    return;
  }

  const body = await readRawBody(request);
  const clientKey = getClientKey(request);
  const rateLimit = getLoginRateLimit(clientKey);
  if (rateLimit.locked) {
    sendLoginPage(response, `Too many attempts. Try again in ${rateLimit.minutesLeft} minute(s).`);
    return;
  }

  const params =
    request.headers["content-type"] && request.headers["content-type"].includes("application/json")
      ? JSON.parse(body || "{}")
      : Object.fromEntries(new URLSearchParams(body));

  const enterpriseCode = normalizeEnterpriseCode(params.enterprise || config.auth.defaultEnterpriseCode);
  const username = normalizeUsername(params.username || config.auth.defaultUsername);
  const user = await findEnterpriseUser(enterpriseCode, username);
  if (!user || user.enterpriseStatus !== "active" || !(await passwordMatches(params.password || "", user.passwordHash))) {
    recordFailedLogin(clientKey);
    sendLoginPage(response, "Wrong enterprise, username, or password.", {
      enterpriseCode,
      username,
    });
    return;
  }

  clearLoginAttempts(clientKey);
  await recordAudit(pool, user, {
    action: "account.login",
    entityType: "user",
    entityId: user.userId,
    summary: "Signed in",
  });
  setSession(response, user);
  redirect(response, "/index.html");
}

async function handleVendorLoginRequest(request, response, requestUrl) {
  if (request.method === "GET") {
    const signed = getVendorSession(request);
    if (signed && (await refreshVendorSessionAccess(signed))) {
      redirect(response, "/vendor-portal");
      return;
    }
    if (signed) clearVendorSession(response);
    sendVendorLoginPage(response, "", {
      enterpriseCode: requestUrl.searchParams.get("enterprise") || "",
      login: requestUrl.searchParams.get("login") || "",
    });
    return;
  }
  if (request.method !== "POST") {
    sendVendorLoginPage(response, "Use the vendor login form to continue.");
    return;
  }

  const clientKey = `vendor:${getClientKey(request)}`;
  const rateLimit = getLoginRateLimit(clientKey);
  if (rateLimit.locked) {
    sendVendorLoginPage(response, `Too many attempts. Try again in ${rateLimit.minutesLeft} minute(s).`);
    return;
  }
  const body = await readRawBody(request);
  const params = Object.fromEntries(new URLSearchParams(body));
  const enterpriseCode = normalizeEnterpriseCode(params.enterprise || "");
  const login = String(params.login || "").trim();
  const account = await findVendorAccountForLogin(enterpriseCode, login);
  if (!account || account.enterpriseStatus !== "active" || account.status !== "active"
      || !(await passwordMatches(params.password || "", account.passwordHash))) {
    recordFailedLogin(clientKey);
    sendVendorLoginPage(response, "Wrong store code, phone/email, or password.", { enterpriseCode, login });
    return;
  }
  clearLoginAttempts(clientKey);
  setVendorSession(response, account);
  redirect(response, "/vendor-portal");
}

async function handleSignupRequest(request, response) {
  if (request.method === "GET") {
    const signedSession = getSession(request);
    if (signedSession && (await refreshSessionAccess(signedSession))) {
      redirect(response, "/index.html");
      return;
    }
    if (signedSession) clearSession(response);
    sendSignupPage(response);
    return;
  }

  if (request.method !== "POST") {
    sendSignupPage(response, "Use the account form to continue.");
    return;
  }

  const clientKey = getClientKey(request);
  if (!canAttemptSignup(clientKey)) {
    sendSignupPage(response, "Too many accounts were created from this connection. Try again later.");
    return;
  }
  recordSignupAttempt(clientKey);

  const body = await readRawBody(request);
  const params =
    request.headers["content-type"] && request.headers["content-type"].includes("application/json")
      ? JSON.parse(body || "{}")
      : Object.fromEntries(new URLSearchParams(body));

  const values = {
    storeName: String(params.storeName || "").trim().slice(0, 160),
    enterpriseCode: normalizeEnterpriseCode(params.enterprise || ""),
    username: normalizeUsername(params.username || ""),
    inviteCode: normalizeInviteCode(params.inviteCode || ""),
    email: normalizeEmail(params.email || ""),
  };
  const validationError = validateSignup(params, values);
  if (validationError) {
    sendSignupPage(response, validationError, values);
    return;
  }

  let account;
  try {
    account = await createEnterpriseAccount({
      storeName: values.storeName,
      enterpriseCode: values.enterpriseCode,
      username: values.username,
      password: String(params.password),
      inviteCode: values.inviteCode,
      email: values.email,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY" || error.code === "ENTERPRISE_EXISTS") {
      sendSignupPage(
        response,
        "That enterprise code is already in use. Choose a different code.",
        values,
      );
      return;
    }
    if (error.code === "INVALID_INVITE") {
      sendSignupPage(
        response,
        "That invitation code is invalid, expired, or has already been used.",
        values,
      );
      return;
    }
    throw error;
  }
  try {
    await sendEmailVerification(account);
  } catch (error) {
    console.error(`Could not send verification email: ${error.message}`);
  }

  const loginUrl = new URL("/login", config.publicOrigin || "http://localhost");
  loginUrl.searchParams.set("created", "1");
  loginUrl.searchParams.set("enterprise", values.enterpriseCode);
  loginUrl.searchParams.set("username", values.username);
  redirect(response, `${loginUrl.pathname}${loginUrl.search}`);
}

function validateSignup(params, values) {
  const rawEnterpriseCode = String(params.enterprise || "").trim();
  const rawUsername = String(params.username || "").trim();
  const password = String(params.password || "");

  if (!values.inviteCode || !/^NC-[A-F0-9]{8}-[A-F0-9]{8}$/.test(values.inviteCode)) {
    return "Enter a valid invitation code from the account administrator.";
  }
  if (values.storeName.length < 2) {
    return "Business name must be at least 2 characters.";
  }
  if (rawEnterpriseCode.length < 3 || values.enterpriseCode.length < 3) {
    return "Enterprise code must be at least 3 letters or numbers.";
  }
  if (rawUsername.length < 3 || values.username.length < 3) {
    return "Username must be at least 3 characters.";
  }
  if (config.email.apiKey && !isValidEmail(values.email)) {
    return "Enter a valid recovery email address.";
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password must be at least 8 characters and include a letter and a number.";
  }
  if (password.length > 128) {
    return "Password cannot be longer than 128 characters.";
  }
  if (password !== String(params.confirmPassword || "")) {
    return "Passwords do not match.";
  }
  return "";
}

async function createEnterpriseAccount({
  storeName,
  enterpriseCode,
  username,
  password,
  inviteCode,
  email,
}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const inviteHash = hashInviteCode(inviteCode);
    const [invites] = await connection.query(
      `
        SELECT id
        FROM customer_credit_signup_invites
        WHERE code_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
        LIMIT 1
        FOR UPDATE
      `,
      [inviteHash],
    );
    if (!invites.length) {
      const error = new Error("Invitation is invalid or unavailable");
      error.code = "INVALID_INVITE";
      throw error;
    }

    const [existing] = await connection.query(
      "SELECT id FROM customer_credit_enterprises WHERE code = ? LIMIT 1 FOR UPDATE",
      [enterpriseCode],
    );
    if (existing.length) {
      const error = new Error("Enterprise code already exists");
      error.code = "ENTERPRISE_EXISTS";
      throw error;
    }

    const enterpriseId = `ent-${crypto.randomBytes(12).toString("hex")}`;
    const ownerUserId = cryptoRandomId();
    const passwordHash = await hashPassword(password);
    await connection.query(
      `
        INSERT INTO customer_credit_enterprises (id, code, name, status)
        VALUES (?, ?, ?, 'active')
      `,
      [enterpriseId, enterpriseCode, storeName],
    );
    await connection.query(
      `
        INSERT INTO customer_credit_users
          (id, enterprise_id, username, display_name, role, password_hash, email)
        VALUES (?, ?, ?, ?, 'owner', ?, ?)
      `,
      [ownerUserId, enterpriseId, username, "Owner", passwordHash, email || null],
    );
    await connection.query(
      `
        UPDATE customer_credit_signup_invites
        SET used_at = UTC_TIMESTAMP(), used_by_enterprise_id = ?
        WHERE id = ? AND used_at IS NULL
      `,
      [enterpriseId, invites[0].id],
    );
    await recordAudit(
      connection,
      {
        enterpriseId,
        userId: ownerUserId,
        username,
      },
      {
        action: "enterprise.created",
        entityType: "enterprise",
        entityId: enterpriseId,
        summary: `Created enterprise ${enterpriseCode}`,
      },
    );
    await connection.commit();
    return {
      enterpriseId,
      enterpriseCode,
      enterpriseName: storeName,
      userId: ownerUserId,
      username,
      email,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function handleForgotPasswordRequest(request, response) {
  if (!config.email.apiKey) {
    sendAccessHelpPage(response);
    return;
  }
  if (request.method === "GET") {
    sendForgotPasswordPage(response);
    return;
  }
  if (request.method !== "POST") {
    sendForgotPasswordPage(response, "Use the recovery form to continue.");
    return;
  }

  const body = await readRawBody(request);
  const params = Object.fromEntries(new URLSearchParams(body));
  const enterpriseCode = normalizeEnterpriseCode(params.enterprise || "");
  const email = normalizeEmail(params.email || "");
  const clientKey = getClientKey(request);

  if (canAttemptRecovery(clientKey) && isValidEmail(email)) {
    recordRecoveryAttempt(clientKey);
    try {
      await sendPasswordResetEmail(enterpriseCode, email);
    } catch (error) {
      console.error(`Password recovery email failed: ${error.message}`);
    }
  }
  sendForgotPasswordPage(
    response,
    "",
    "If the enterprise and verified email match, a recovery link has been sent.",
  );
}

async function handleResetPasswordRequest(request, response, requestUrl) {
  if (request.method === "GET") {
    const token = String(requestUrl.searchParams.get("token") || "");
    sendResetPasswordPage(response, token);
    return;
  }
  if (request.method !== "POST") {
    sendResetPasswordPage(response, "", "Use the reset form to continue.");
    return;
  }

  const params = Object.fromEntries(new URLSearchParams(await readRawBody(request)));
  const token = String(params.token || "");
  const password = String(params.password || "");
  try {
    validateAccountPassword(password);
    if (password !== String(params.confirmPassword || "")) {
      throw httpError(400, "Passwords do not match");
    }
    await resetPasswordWithToken(token, password);
    sendResetPasswordPage(
      response,
      "",
      "",
      "Password updated. Return to login with your username and new password.",
    );
  } catch (error) {
    sendResetPasswordPage(
      response,
      token,
      error.statusCode ? error.message : "This recovery link is invalid or expired.",
    );
  }
}

async function handleVerifyEmailRequest(response, requestUrl) {
  const token = String(requestUrl.searchParams.get("token") || "");
  try {
    await verifyEmailWithToken(token);
    sendEmailVerificationPage(response, true);
  } catch {
    sendEmailVerificationPage(response, false);
  }
}

async function sendPasswordResetEmail(enterpriseCode, email) {
  const [rows] = await pool.query(
    `
      SELECT
        e.id AS enterpriseId,
        e.name AS enterpriseName,
        u.id AS userId,
        u.username,
        u.email
      FROM customer_credit_enterprises e
      INNER JOIN customer_credit_users u ON u.enterprise_id = e.id
      WHERE
        e.code = ?
        AND e.status = 'active'
        AND LOWER(u.email) = ?
        AND u.email_verified_at IS NOT NULL
      LIMIT 1
    `,
    [enterpriseCode, email],
  );
  if (!rows.length) return;

  const user = rows[0];
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = toMysqlDateTime(
    new Date(Date.now() + Math.max(10, config.email.resetMinutes) * 60 * 1000).toISOString(),
  );
  await pool.query(
    "UPDATE customer_credit_password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL",
    [user.userId],
  );
  await pool.query(
    `
      INSERT INTO customer_credit_password_reset_tokens
        (id, user_id, enterprise_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    [cryptoRandomId(), user.userId, user.enterpriseId, hashSecurityToken(token), expiresAt],
  );
  const resetUrl = new URL("/reset-password", config.publicOrigin);
  resetUrl.searchParams.set("token", token);
  await sendTransactionalEmail({
    to: user.email,
    subject: "Reset your Nazi Credit password",
    html: `
      <h1>Password reset</h1>
      <p>A password reset was requested for ${escapeHtmlServer(user.enterpriseName)}.</p>
      <p>Your username is <strong>${escapeHtmlServer(user.username)}</strong>.</p>
      <p><a href="${escapeHtmlServer(resetUrl.toString())}">Create a new password</a></p>
      <p>This single-use link expires in ${Math.max(10, config.email.resetMinutes)} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}

async function resetPasswordWithToken(token, password) {
  if (!/^[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw httpError(400, "This recovery link is invalid or expired");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `
        SELECT
          token.id AS tokenId,
          token.user_id AS userId,
          token.enterprise_id AS enterpriseId,
          users.username
        FROM customer_credit_password_reset_tokens token
        INNER JOIN customer_credit_users users ON users.id = token.user_id
        INNER JOIN customer_credit_enterprises enterprises ON enterprises.id = token.enterprise_id
        WHERE
          token.token_hash = ?
          AND token.used_at IS NULL
          AND token.expires_at > UTC_TIMESTAMP()
          AND enterprises.status = 'active'
        LIMIT 1
        FOR UPDATE
      `,
      [hashSecurityToken(token)],
    );
    if (!rows.length) throw httpError(400, "This recovery link is invalid or expired");
    const row = rows[0];
    await connection.query(
      `
        UPDATE customer_credit_users
        SET password_hash = ?, must_change_password = 0, session_version = session_version + 1
        WHERE id = ? AND enterprise_id = ?
      `,
      [await hashPassword(password), row.userId, row.enterpriseId],
    );
    await connection.query(
      "UPDATE customer_credit_password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?",
      [row.tokenId],
    );
    await recordAudit(
      connection,
      { enterpriseId: row.enterpriseId, userId: row.userId, username: row.username },
      {
        action: "account.password_recovered",
        entityType: "user",
        entityId: row.userId,
        summary: "Reset password by verified email",
      },
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function sendEmailVerification(account) {
  if (!account.email) return;
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = toMysqlDateTime(
    new Date(Date.now() + Math.max(1, config.email.verifyHours) * 60 * 60 * 1000).toISOString(),
  );
  await pool.query(
    "UPDATE customer_credit_email_verification_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL",
    [account.userId],
  );
  await pool.query(
    `
      INSERT INTO customer_credit_email_verification_tokens
        (id, user_id, enterprise_id, email, token_hash, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      cryptoRandomId(),
      account.userId,
      account.enterpriseId,
      account.email,
      hashSecurityToken(token),
      expiresAt,
    ],
  );
  const verifyUrl = new URL("/verify-email", config.publicOrigin);
  verifyUrl.searchParams.set("token", token);
  await sendTransactionalEmail({
    to: account.email,
    subject: "Verify your Nazi Credit recovery email",
    html: `
      <h1>Verify recovery email</h1>
      <p>Verify this address for ${escapeHtmlServer(account.enterpriseName)}.</p>
      <p><a href="${escapeHtmlServer(verifyUrl.toString())}">Verify recovery email</a></p>
      <p>This link expires in ${Math.max(1, config.email.verifyHours)} hours.</p>
    `,
  });
}

async function verifyEmailWithToken(token) {
  if (!/^[A-Za-z0-9_-]{30,}$/.test(token)) throw httpError(400, "Invalid verification link");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `
        SELECT id, user_id AS userId, enterprise_id AS enterpriseId, email
        FROM customer_credit_email_verification_tokens
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
        LIMIT 1
        FOR UPDATE
      `,
      [hashSecurityToken(token)],
    );
    if (!rows.length) throw httpError(400, "Invalid verification link");
    const row = rows[0];
    const [result] = await connection.query(
      `
        UPDATE customer_credit_users
        SET email_verified_at = UTC_TIMESTAMP()
        WHERE id = ? AND enterprise_id = ? AND email = ?
      `,
      [row.userId, row.enterpriseId, row.email],
    );
    if (!result.affectedRows) throw httpError(400, "Email address has changed");
    await connection.query(
      "UPDATE customer_credit_email_verification_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?",
      [row.id],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function sendTransactionalEmail({ to, subject, html }) {
  if (!config.email.apiKey) throw new Error("Email delivery is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.email.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.email.from,
      to: [to],
      subject,
      html,
    }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.message || `Email provider returned ${response.status}`);
  }
}

async function sendVendorRecordEmail(session, vendor) {
  if (!vendor.email) return { sent: false, reason: "missing_email" };
  if (!config.email.apiKey) return { sent: false, reason: "not_configured" };

  const action = vendorRecordAction(vendor);
  const unitPrice = Number(vendor.amount || 0);
  const total = action.quantity * unitPrice * action.sign;
  const product = vendor.reference || "Vendor product";
  let statementLink = "";
  try {
    statementLink = config.publicOrigin
      ? new URL("/vendor-tracking.html#statement", config.publicOrigin).toString()
      : "";
  } catch {}

  await sendTransactionalEmail({
    to: vendor.email,
    subject: `${action.label} recorded: ${product}`,
    html: `
      <h1>Vendor record saved</h1>
      <p>${escapeHtmlServer(session.enterpriseName || config.auth.storeName)} recorded a vendor item for <strong>${escapeHtmlServer(vendor.vendorName)}</strong>.</p>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #d0d7de;width:100%;max-width:640px">
        <tr><th align="left" style="border:1px solid #d0d7de;background:#f6f8fa">Type</th><td style="border:1px solid #d0d7de">${escapeHtmlServer(action.label)}</td></tr>
        <tr><th align="left" style="border:1px solid #d0d7de;background:#f6f8fa">Product</th><td style="border:1px solid #d0d7de">${escapeHtmlServer(product)}</td></tr>
        <tr><th align="left" style="border:1px solid #d0d7de;background:#f6f8fa">Recorded quantity</th><td style="border:1px solid #d0d7de">${escapeHtmlServer(`${formatServerQuantity(action.quantity)} ${vendor.unit || "piece"}`)}</td></tr>
        <tr><th align="left" style="border:1px solid #d0d7de;background:#f6f8fa">Unit price</th><td style="border:1px solid #d0d7de">${escapeHtmlServer(formatServerMoney(unitPrice))}</td></tr>
        <tr><th align="left" style="border:1px solid #d0d7de;background:#f6f8fa">Record amount</th><td style="border:1px solid #d0d7de">${escapeHtmlServer(formatServerMoney(total))}</td></tr>
        <tr><th align="left" style="border:1px solid #d0d7de;background:#f6f8fa">Date recorded</th><td style="border:1px solid #d0d7de">${escapeHtmlServer(formatServerDateTime(vendor.createdAt))}</td></tr>
        ${vendor.note ? `<tr><th align="left" style="border:1px solid #d0d7de;background:#f6f8fa">Note</th><td style="border:1px solid #d0d7de">${escapeHtmlServer(vendor.note)}</td></tr>` : ""}
      </table>
      ${statementLink ? `<p><a href="${escapeHtmlServer(statementLink)}">Open vendor statement</a></p>` : ""}
      <p>This is an automatic email from NaziCredit.</p>
    `,
  });

  return { sent: true, email: vendor.email };
}

function vendorRecordAction(vendor) {
  if (Number(vendor.receivedQuantity) > 0) return { label: "Received", quantity: Number(vendor.receivedQuantity), sign: 1 };
  if (Number(vendor.spoiledQuantity) > 0) return { label: "Spoiled", quantity: Number(vendor.spoiledQuantity), sign: -1 };
  if (Number(vendor.returnedQuantity) > 0) return { label: "Returned", quantity: Number(vendor.returnedQuantity), sign: -1 };
  return { label: "Recorded", quantity: Number(vendor.quantity || 0), sign: 1 };
}

function formatServerMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
}

function formatServerQuantity(value) {
  const quantity = Number(value) || 0;
  return Number(quantity.toFixed(2)).toString();
}

function formatServerDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString("en-US");
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function hashSecurityToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function canAttemptRecovery(clientKey) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const attempts = (recoveryAttempts.get(clientKey) || []).filter((time) => time >= cutoff);
  recoveryAttempts.set(clientKey, attempts);
  return attempts.length < 5;
}

function recordRecoveryAttempt(clientKey) {
  const attempts = recoveryAttempts.get(clientKey) || [];
  attempts.push(Date.now());
  recoveryAttempts.set(clientKey, attempts);
}

async function handleApiRequest(request, response, requestUrl, session) {
  if (request.method === "GET" && requestUrl.pathname === "/api/ai-dashboard/metrics") {
    requireOwnerPin(session);
    sendJson(response, 200, { ok: true, ...(await getAiDashboardMetrics(session.enterpriseId)) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/ai-dashboard/summary") {
    requireOwnerPin(session);
    const body = await readJsonBody(request);
    const language = String(body.language || "English").toLowerCase() === "amharic" ? "Amharic" : "English";
    const metrics = await getAiDashboardMetrics(session.enterpriseId);
    const cacheKey = `${session.enterpriseId}:${language}:${metrics.generatedAt.slice(0, 13)}`;
    const cached = aiSummaryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      sendJson(response, 200, { ok: true, summary: cached.summary, cached: true });
      return;
    }
    const summary = await askOpenAI({
      instructions: `You are a grocery store business analyst. Use only the supplied store data. Write in ${language}. Give a concise operational summary followed by 3 practical recommendations. Never invent numbers. If a field is unavailable, omit it.`,
      input: JSON.stringify(metrics.aiContext),
    });
    aiSummaryCache.set(cacheKey, {
      summary,
      expiresAt: Date.now() + config.openai.summaryCacheMinutes * 60_000,
    });
    sendJson(response, 200, { ok: true, summary, cached: false });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/ai-dashboard/ask") {
    requireOwnerPin(session);
    const body = await readJsonBody(request);
    const question = requiredString(body.question, "Question").slice(0, 1000);
    const metrics = await getAiDashboardMetrics(session.enterpriseId);
    const answer = await askOpenAI({
      instructions: "Answer the owner's question using only the supplied store database snapshot. Do not use outside knowledge or guess. Say when the data does not contain the answer. Match the user's language, including Amharic.",
      input: `STORE DATA:\n${JSON.stringify(metrics.aiContext)}\n\nQUESTION:\n${question}`,
    });
    sendJson(response, 200, { ok: true, answer });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/ai/interpret-command") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const context = ["vendor", "order", "barcode"].includes(body.context) ? body.context : "order";
    const command = requiredString(body.command, "Command").slice(0, 1500);
    const referenceData = await getAiReferenceData(session.enterpriseId, context);
    const draft = await askOpenAIJson({
      instructions: `Extract a ${context} draft from English, Amharic, or mixed speech. Never perform an action. Return only fields explicitly stated or confidently derived (such as the next occurrence of Saturday). Do not change prices, mark paid, complete, or delete anything. Existing reference data is supplied to avoid duplicates.`,
      input: `REFERENCE DATA:\n${JSON.stringify(referenceData)}\n\nCOMMAND:\n${command}`,
      schema: aiDraftSchema(context),
    });
    sendJson(response, 200, { ok: true, context, draft });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/ai/transcribe") {
    requireRecordManager(session);
    const body = await readJsonBody(request, 12_000_000);
    const transcript = await transcribeAudio(body.audioBase64, body.mimeType);
    sendJson(response, 200, { ok: true, transcript });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/barcode-print-events") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const labelCount = Math.max(1, Math.min(5000, Number(body.labelCount) || 1));
    await pool.query(`INSERT INTO customer_credit_barcode_print_events
      (id, enterprise_id, label_count, printed_by) VALUES (?,?,?,?)`,
      [cryptoRandomId(), session.enterpriseId, labelCount, session.username]);
    sendJson(response, 201, { ok: true });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/me") {
    sendJson(response, 200, {
      ok: true,
      enterprise: {
        id: session.enterpriseId,
        code: session.enterpriseCode,
        name: session.enterpriseName,
      },
      user: {
        id: session.userId,
        username: session.username,
        role: publicRole(session.role),
        mustChangePassword: Boolean(session.mustChangePassword),
        email: session.email || "",
        emailVerified: Boolean(session.emailVerifiedAt),
      },
      permissions: {
        manageSignupInvites: isPlatformAdminSession(session),
        manageEnterprises: isPlatformAdminSession(session),
        manageUsers: session.role === "owner",
        manageRecords: session.role === "owner" || isEmployeeRole(session.role),
        resendOrderNotifications: canResendOrderNotification(session.role),
        viewActivity: session.role === "owner",
        emailRecoveryEnabled: Boolean(config.email.apiKey),
        ownerPinUnlocked: hasOwnerPinAccess(session),
      },
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/vendor-statements/access") {
    requireOwnerPin(session);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/owner-pin/verify") {
    requireEnterpriseOwner(session);
    const body = await readJsonBody(request);
    const suppliedPin = String(body.pin || "").trim();
    if (!/^\d{4,8}$/.test(suppliedPin) || !safeEqualText(suppliedPin, config.auth.ownerPin)) {
      throw httpError(403, "Incorrect owner PIN");
    }
    ownerPinUnlocks.set(session.userId, Date.now() + 15 * 60 * 1000);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (session.mustChangePassword && request.method !== "GET" && requestUrl.pathname !== "/api/account/password") {
    throw httpError(403, "Change your temporary password before making updates");
  }

  if (request.method === "PATCH" && requestUrl.pathname === "/api/account/password") {
    const body = await readJsonBody(request);
    const sessionVersion = await changeOwnPassword(
      session,
      body.currentPassword,
      body.newPassword,
    );
    setSession(response, { ...session, mustChangePassword: false, sessionVersion });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "PATCH" && requestUrl.pathname === "/api/account/email") {
    const body = await readJsonBody(request);
    const email = await updateOwnRecoveryEmail(session, body.email);
    sendJson(response, 200, { ok: true, email, emailVerified: false });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/account/email/resend") {
    await resendOwnEmailVerification(session);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (requestUrl.pathname === "/api/users") {
    requireEnterpriseOwner(session);
    if (request.method === "GET") {
      sendJson(response, 200, { ok: true, users: await listEnterpriseUsers(session.enterpriseId) });
      return;
    }
    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const user = await createEnterpriseUser(session, body);
      sendJson(response, 201, { ok: true, user });
      return;
    }
  }

  const userMatch = requestUrl.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && (request.method === "PATCH" || request.method === "DELETE")) {
    requireEnterpriseOwner(session);
    if (request.method === "PATCH") {
      const body = await readJsonBody(request);
      const user = await updateEnterpriseUser(session, userMatch[1], body);
      sendJson(response, 200, { ok: true, user });
      return;
    }
    await deleteEnterpriseUser(session, userMatch[1]);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/activity") {
    requireEnterpriseOwner(session);
    sendJson(response, 200, { ok: true, activity: await listEnterpriseActivity(session.enterpriseId) });
    return;
  }

  if (requestUrl.pathname === "/api/admin/enterprises") {
    requirePlatformAdmin(session);
    if (request.method === "GET") {
      sendJson(response, 200, { ok: true, enterprises: await listManagedEnterprises() });
      return;
    }
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin/summary") {
    requirePlatformAdmin(session);
    sendJson(response, 200, { ok: true, summary: await getAdminSummary() });
    return;
  }

  const enterpriseUsersMatch = requestUrl.pathname.match(
    /^\/api\/admin\/enterprises\/([^/]+)\/users$/,
  );
  if (request.method === "GET" && enterpriseUsersMatch) {
    requirePlatformAdmin(session);
    sendJson(response, 200, {
      ok: true,
      users: await listManagedEnterpriseUsers(enterpriseUsersMatch[1]),
    });
    return;
  }

  const managedUserAccessMatch = requestUrl.pathname.match(
    /^\/api\/admin\/users\/([^/]+)\/access$/,
  );
  if (request.method === "PATCH" && managedUserAccessMatch) {
    requirePlatformAdmin(session);
    const body = await readJsonBody(request);
    const user = await resetManagedUserAccess(session, managedUserAccessMatch[1], body);
    sendJson(response, 200, { ok: true, user });
    return;
  }

  const enterpriseAccessMatch = requestUrl.pathname.match(
    /^\/api\/admin\/enterprises\/([^/]+)\/access$/,
  );
  if (request.method === "PATCH" && enterpriseAccessMatch) {
    requirePlatformAdmin(session);
    const body = await readJsonBody(request);
    const enterprise = await resetEnterpriseAccess(session, enterpriseAccessMatch[1], body);
    sendJson(response, 200, { ok: true, enterprise });
    return;
  }

  const enterpriseMatch = requestUrl.pathname.match(/^\/api\/admin\/enterprises\/([^/]+)$/);
  if (enterpriseMatch && (request.method === "PATCH" || request.method === "DELETE")) {
    requirePlatformAdmin(session);
    const body = await readJsonBody(request);
    if (request.method === "PATCH") {
      const enterprise = await updateEnterpriseStatus(session, enterpriseMatch[1], body.status);
      sendJson(response, 200, { ok: true, enterprise });
      return;
    }
    await deleteManagedEnterprise(session, enterpriseMatch[1], body.confirmCode);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (requestUrl.pathname === "/api/signup-invites") {
    if (!isPlatformAdminSession(session)) {
      sendJson(response, 403, { ok: false, error: "Platform owner access required" });
      return;
    }

    if (request.method === "GET") {
      sendJson(response, 200, { ok: true, invites: await listSignupInvites() });
      return;
    }

    if (request.method === "POST") {
      const invite = await createSignupInvite(session);
      sendJson(response, 201, { ok: true, invite });
      return;
    }
  }

  const inviteMatch = requestUrl.pathname.match(/^\/api\/signup-invites\/([^/]+)$/);
  if (request.method === "DELETE" && inviteMatch) {
    if (!isPlatformAdminSession(session)) {
      sendJson(response, 403, { ok: false, error: "Platform owner access required" });
      return;
    }
    await revokeSignupInvite(inviteMatch[1], session);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/products") {
    sendJson(response, 200, { ok: true, products: await listProducts(session.enterpriseId) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/products") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const product = await upsertProduct(session.enterpriseId, normalizeProduct(body));
    await recordAudit(pool, session, {
      action: "product.saved",
      entityType: "product",
      entityId: product.id,
      summary: `Saved product ${product.name}`,
    });
    sendJson(response, 201, { ok: true, product });
    return;
  }

  const productMatch = requestUrl.pathname.match(/^\/api\/products\/([^/]+)$/);
  if (request.method === "DELETE" && productMatch) {
    requireRecordManager(session);
    await deleteProduct(session, productMatch[1]);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/vendors") {
    sendJson(response, 200, { ok: true, vendors: await listVendors(session.enterpriseId) });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/vendor-accounts") {
    sendJson(response, 200, { ok: true, vendors: await listVendorAccounts(session.enterpriseId) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/vendor-accounts") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const result = await createVendorAccount(session, body);
    sendJson(response, result.created ? 201 : 200, { ok: true, ...result });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/vendors/spoilage-history") {
    sendJson(response, 200, { ok: true, history: await listVendorSpoilageHistory(session.enterpriseId) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/vendors") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const vendor = await upsertVendor(session, normalizeVendorEntry(body));
    await recordAudit(pool, session, {
      action: "vendor.saved",
      entityType: "vendor",
      entityId: vendor.id,
      summary: `Saved vendor ${vendor.vendorName}`,
    });
    let notification = null;
    try {
      notification = await sendVendorRecordEmail(session, vendor);
    } catch (error) {
      console.error(`Vendor record email failed: ${error.message}`);
      notification = { sent: false, error: "Vendor email could not be sent" };
    }
    sendJson(response, 201, { ok: true, vendor, notification });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/vendors/mark-paid") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const result = await markVendorsPaid(session, body.ids);
    sendJson(response, 200, { ok: true, ...result, vendors: await listVendors(session.enterpriseId) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/vendors/mark-unpaid") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const result = await setVendorsUnpaid(session, body.ids);
    sendJson(response, 200, { ok: true, ...result, vendors: await listVendors(session.enterpriseId) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/vendors/clear-paid") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const ids = [...new Set(
      (Array.isArray(body.ids) ? body.ids : [])
        .map((id) => String(id || "").trim())
        .filter((id) => id.length > 0 && id.length <= 128),
    )].slice(0, 1000);
    if (!ids.length) {
      sendJson(response, 200, { ok: true, deletedCount: 0 });
      return;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const [result] = await pool.query(
      `DELETE FROM customer_credit_vendor_tracking WHERE enterprise_id = ? AND id IN (${placeholders})`,
      [session.enterpriseId, ...ids],
    );
    await recordAudit(pool, session, {
      action: "vendor.paid_records_cleared",
      entityType: "vendor",
      summary: `Cleared ${result.affectedRows} paid vendor record${result.affectedRows === 1 ? "" : "s"}`,
    });
    sendJson(response, 200, { ok: true, deletedCount: result.affectedRows });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/meat-orders") {
    sendJson(response, 200, {
      ok: true,
      orders: await listMeatOrders(session.enterpriseId),
      serverTime: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/meat-orders") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const order = await createMeatOrder(session.enterpriseId, normalizeMeatOrder(body));
    await recordAudit(pool, session, {
      action: "meat_order.created",
      entityType: "meat_order",
      entityId: order.id,
      summary: `Created meat order for ${order.customerName}`,
    });
    sendJson(response, 201, { ok: true, order });
    return;
  }

  const meatOrderMatch = requestUrl.pathname.match(/^\/api\/meat-orders\/([^/]+)$/);
  if (request.method === "PUT" && meatOrderMatch) {
    requireRecordManager(session);
    const orderId = decodeURIComponent(meatOrderMatch[1]);
    const body = await readJsonBody(request);
    const order = await updateMeatOrder(session.enterpriseId, orderId, normalizeMeatOrder({ ...body, id: orderId }));
    if (!order) throw httpError(404, "Order not found");
    await recordAudit(pool, session, { action: "meat_order.updated", entityType: "meat_order", entityId: orderId, summary: `Updated meat order for ${order.customerName}` });
    sendJson(response, 200, { ok: true, order });
    return;
  }

  const meatOrderStatusMatch = requestUrl.pathname.match(/^\/api\/meat-orders\/([^/]+)\/status$/);
  if (request.method === "PATCH" && meatOrderStatusMatch) {
    requireRecordManager(session);
    const orderId = decodeURIComponent(meatOrderStatusMatch[1]);
    const body = await readJsonBody(request);
    const status = String(body.status || "").trim().toLowerCase();
    if (!isOrderStatus(status)) throw httpError(400, "Invalid order status");
    const existingOrder = (await listMeatOrders(session.enterpriseId)).find((item) => item.id === orderId);
    if (!existingOrder) throw httpError(404, "Order not found");
    if (!canTransitionOrderStatus(existingOrder.status, status)) {
      throw httpError(409, `Order cannot move from ${existingOrder.status.replace("_", " ")} to ${status.replace("_", " ")}`);
    }
    const completedBy = status === "picked_up"
      ? requiredString(body.completedBy || session.username, "Completed by").slice(0, 160)
      : null;
    const order = await setMeatOrderStatus(session.enterpriseId, orderId, status, completedBy);
    if (!order) throw httpError(404, "Order not found");
    let notification = null;
    let notificationError = null;
    if (status === "ready" && !order.notificationSentAt) {
      try {
        notification = await sendReadyNotification(session.enterpriseId, orderId, false);
      } catch (error) {
        notificationError = error.message || "Notification delivery failed";
      }
    }
    const updatedOrder = notification ? notification.order : (await listMeatOrders(session.enterpriseId)).find((item) => item.id === orderId);
    await recordAudit(pool, session, {
      action: `meat_order.${status}`,
      entityType: "meat_order",
      entityId: orderId,
      summary: `Changed order for ${order.customerName} to ${status.replace("_", " ")}`,
    });
    sendJson(response, 200, { ok: true, order: updatedOrder, notification: notification?.delivery || null, notificationError });
    return;
  }

  const meatOrderNotificationMatch = requestUrl.pathname.match(/^\/api\/meat-orders\/([^/]+)\/notification$/);
  if (request.method === "POST" && meatOrderNotificationMatch) {
    const orderId = decodeURIComponent(meatOrderNotificationMatch[1]);
    const existingOrder = (await listMeatOrders(session.enterpriseId)).find((item) => item.id === orderId);
    if (!existingOrder) throw httpError(404, "Order not found");
    if (existingOrder.notificationSentAt) requireOrderNotificationManager(session);
    else requireRecordManager(session);
    const notification = await sendReadyNotification(session.enterpriseId, orderId, Boolean(existingOrder.notificationSentAt));
    await recordAudit(pool, session, {
      action: existingOrder.notificationSentAt ? "meat_order.notification_resent" : "meat_order.notification_sent",
      entityType: "meat_order", entityId: orderId,
      summary: `${existingOrder.notificationSentAt ? "Resent" : "Sent"} ready notification for ${notification.order.customerName}`,
    });
    sendJson(response, 200, { ok: true, order: notification.order, notification: notification.delivery });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/finance/entries") {
    requireOwnerPin(session);
    const entryType = requestUrl.searchParams.get("type");
    sendJson(response, 200, {
      ok: true,
      entries: await listFinanceEntries(session.enterpriseId, entryType),
    });
    return;
  }

  if (request.method === "DELETE" && requestUrl.pathname === "/api/finance/entries") {
    requireOwnerPin(session);
    const body = await readJsonBody(request);
    if (String(body.confirmation || "").trim() !== "CLEAR ALL") {
      throw new Error("Type CLEAR ALL to confirm");
    }
    const [result] = await pool.query(
      "DELETE FROM customer_credit_finance_entries WHERE enterprise_id = ?",
      [session.enterpriseId],
    );
    await recordAudit(pool, session, {
      action: "finance.cleared",
      entityType: "finance_entry",
      summary: `Cleared ${result.affectedRows} finance entries`,
    });
    sendJson(response, 200, { ok: true, deletedCount: result.affectedRows });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/finance/summary") {
    requireOwnerPin(session);
    sendJson(response, 200, {
      ok: true,
      summary: await getFinanceSummary(session.enterpriseId),
      reports: await getFinanceReports(session.enterpriseId),
      serverTime: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/finance/entries") {
    requireOwnerPin(session);
    const body = await readJsonBody(request);
    const entry = await createFinanceEntry(session.enterpriseId, normalizeFinanceEntry(body));
    await recordAudit(pool, session, {
      action: `finance.${entry.entryType}.created`,
      entityType: "finance_entry",
      entityId: entry.id,
      summary: `Added ${entry.entryType} ${entry.amount.toFixed(2)} in ${entry.category}`,
    });
    sendJson(response, 201, { ok: true, entry });
    return;
  }

  const financeEntryMatch = requestUrl.pathname.match(/^\/api\/finance\/entries\/([^/]+)$/);
  if (financeEntryMatch && request.method === "PATCH") {
    requireOwnerPin(session);
    const body = await readJsonBody(request);
    const entry = await updateFinanceEntry(
      session.enterpriseId,
      financeEntryMatch[1],
      normalizeFinanceEntry({ ...body, id: financeEntryMatch[1] }),
    );
    await recordAudit(pool, session, {
      action: `finance.${entry.entryType}.updated`,
      entityType: "finance_entry",
      entityId: entry.id,
      summary: `Updated ${entry.entryType} ${entry.amount.toFixed(2)} in ${entry.category}`,
    });
    sendJson(response, 200, { ok: true, entry });
    return;
  }

  if (financeEntryMatch && request.method === "DELETE") {
    requireOwnerPin(session);
    await deleteFinanceEntry(session, financeEntryMatch[1]);
    sendJson(response, 200, { ok: true });
    return;
  }

  const vendorMatch = requestUrl.pathname.match(/^\/api\/vendors\/([^/]+)$/);
  if (request.method === "DELETE" && vendorMatch) {
    requireRecordManager(session);
    await deleteVendor(session, vendorMatch[1]);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/records") {
    sendJson(response, 200, { ok: true, records: await listRecords(session.enterpriseId) });
    return;
  }

  if (request.method === "PUT" && requestUrl.pathname === "/api/records") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    await saveRecords(
      session,
      Array.isArray(body.records) ? body.records : [],
      normalizeAuditInput(body.audit),
    );
    sendJson(response, 200, { ok: true, records: await listRecords(session.enterpriseId) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/records") {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const record = normalizeRecord(body);
    await upsertRecordWithPayments(session.enterpriseId, record);
    await recordAudit(pool, session, {
      action: "credit.created",
      entityType: "credit",
      entityId: record.id,
      summary: `Created credit for ${record.customerName}`,
    });
    sendJson(response, 201, { ok: true, record });
    return;
  }

  const paymentMatch = requestUrl.pathname.match(/^\/api\/records\/([^/]+)\/payments$/);
  if (request.method === "POST" && paymentMatch) {
    requireRecordManager(session);
    const body = await readJsonBody(request);
    const payment = normalizePayment(body);
    await insertPayment(session.enterpriseId, paymentMatch[1], payment);
    await recordAudit(pool, session, {
      action: "payment.added",
      entityType: "payment",
      entityId: payment.id,
      summary: "Added a customer payment",
    });
    sendJson(response, 201, { ok: true, payment });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found" });
}

async function serveStaticFile(requestUrl, response) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = decodeURIComponent(pathname).replace(/^[/\\]+/, "");
  const filePath = path.resolve(__dirname, safePath);
  const relative = path.relative(__dirname, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

async function ensureDatabase() {
  if (!config.db.autoCreate) return;

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } catch (error) {
    if (error.code !== "ER_DBACCESS_DENIED_ERROR" && error.code !== "ER_ACCESS_DENIED_ERROR") {
      throw error;
    }
    console.warn("Skipping database creation because the MySQL user cannot create databases.");
    console.warn(`Make sure database '${config.db.database}' already exists.`);
  } finally {
    await connection.end();
  }
}

async function ensureSchema() {
  await pool.query(`
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_users (
      id VARCHAR(64) PRIMARY KEY,
      enterprise_id VARCHAR(64) NOT NULL,
      username VARCHAR(80) NOT NULL,
      display_name VARCHAR(160) NOT NULL,
      role ENUM('owner', 'staff', 'viewer') NOT NULL DEFAULT 'owner',
      password_hash VARCHAR(255) NOT NULL,
      must_change_password TINYINT(1) NOT NULL DEFAULT 0,
      session_version INT NOT NULL DEFAULT 1,
      email VARCHAR(254) NULL,
      email_verified_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_customer_credit_user_enterprise_username (enterprise_id, username),
      INDEX idx_customer_credit_users_enterprise (enterprise_id),
      CONSTRAINT fk_customer_credit_users_enterprise
        FOREIGN KEY (enterprise_id) REFERENCES customer_credit_enterprises(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(
    "customer_credit_users",
    "must_change_password",
    "TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash",
  );
  await addColumnIfMissing(
    "customer_credit_users",
    "session_version",
    "INT NOT NULL DEFAULT 1 AFTER must_change_password",
  );
  await addColumnIfMissing(
    "customer_credit_users",
    "email",
    "VARCHAR(254) NULL AFTER session_version",
  );
  await addColumnIfMissing(
    "customer_credit_users",
    "email_verified_at",
    "DATETIME NULL AFTER email",
  );
  await addIndexIfMissing(
    "customer_credit_users",
    "uq_customer_credit_user_enterprise_email",
    "ADD UNIQUE INDEX uq_customer_credit_user_enterprise_email (enterprise_id, email)",
  );

  const defaultEnterprise = await ensureDefaultEnterprise();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_products (
      id VARCHAR(64) PRIMARY KEY,
      enterprise_id VARCHAR(64) NOT NULL,
      name VARCHAR(160) NOT NULL,
      price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      barcode VARCHAR(80) NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      label_size ENUM('small', 'medium', 'large') NOT NULL DEFAULT 'medium',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_customer_credit_product_enterprise_barcode (enterprise_id, barcode),
      INDEX idx_customer_credit_products_enterprise_updated (enterprise_id, updated_at),
      CONSTRAINT fk_customer_credit_products_enterprise
        FOREIGN KEY (enterprise_id) REFERENCES customer_credit_enterprises(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_barcode_print_events (
      id VARCHAR(64) PRIMARY KEY,
      enterprise_id VARCHAR(64) NOT NULL,
      label_count INT NOT NULL DEFAULT 1,
      printed_by VARCHAR(160) NOT NULL,
      printed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_barcode_print_enterprise_date (enterprise_id, printed_at),
      CONSTRAINT fk_barcode_print_enterprise
        FOREIGN KEY (enterprise_id) REFERENCES customer_credit_enterprises(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(
    "customer_credit_products",
    "quantity",
    "INT NOT NULL DEFAULT 1 AFTER barcode",
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_vendor_accounts (
      id VARCHAR(64) PRIMARY KEY,
      enterprise_id VARCHAR(64) NOT NULL,
      vendor_name VARCHAR(160) NOT NULL,
      phone VARCHAR(60) NULL,
      phone_normalized VARCHAR(60) NULL,
      email VARCHAR(254) NULL,
      email_normalized VARCHAR(254) NULL,
      password_hash VARCHAR(255) NOT NULL,
      session_version INT NOT NULL DEFAULT 1,
      status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_vendor_account_enterprise_phone (enterprise_id, phone_normalized),
      UNIQUE KEY uq_vendor_account_enterprise_email (enterprise_id, email_normalized),
      INDEX idx_vendor_account_enterprise_name (enterprise_id, vendor_name),
      CONSTRAINT fk_vendor_account_enterprise FOREIGN KEY (enterprise_id)
        REFERENCES customer_credit_enterprises(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_vendor_tracking (
      id VARCHAR(64) PRIMARY KEY,
      enterprise_id VARCHAR(64) NOT NULL,
      vendor_account_id VARCHAR(64) NULL,
      vendor_name VARCHAR(160) NOT NULL,
      contact_name VARCHAR(160) NULL,
      quantity INT NOT NULL DEFAULT 1,
      unit VARCHAR(40) NOT NULL DEFAULT 'piece',
      received_quantity INT NOT NULL DEFAULT 0,
      spoiled_quantity INT NOT NULL DEFAULT 0,
      accepted_quantity INT NOT NULL DEFAULT 0,
      returned_quantity INT NOT NULL DEFAULT 0,
      phone VARCHAR(60) NULL,
      email VARCHAR(254) NULL,
      reference VARCHAR(120) NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      due_date DATE NULL,
      status ENUM('ordered', 'received', 'due', 'paid') NOT NULL DEFAULT 'ordered',
      note VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_customer_credit_vendor_enterprise_updated (enterprise_id, updated_at),
      CONSTRAINT fk_customer_credit_vendor_enterprise
        FOREIGN KEY (enterprise_id) REFERENCES customer_credit_enterprises(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(
    "customer_credit_vendor_tracking",
    "vendor_account_id",
    "VARCHAR(64) NULL AFTER enterprise_id",
  );
  await addIndexIfMissing(
    "customer_credit_vendor_tracking",
    "idx_vendor_tracking_account",
    "ADD INDEX idx_vendor_tracking_account (enterprise_id, vendor_account_id)",
  );
  await addColumnIfMissing(
    "customer_credit_vendor_tracking",
    "quantity",
    "INT NOT NULL DEFAULT 1 AFTER contact_name",
  );
  await addColumnIfMissing(
    "customer_credit_vendor_tracking",
    "unit",
    "VARCHAR(40) NOT NULL DEFAULT 'piece' AFTER quantity",
  );
  await addColumnIfMissing(
    "customer_credit_vendor_tracking",
    "received_quantity",
    "INT NOT NULL DEFAULT 0 AFTER quantity",
  );
  await addColumnIfMissing(
    "customer_credit_vendor_tracking",
    "spoiled_quantity",
    "INT NOT NULL DEFAULT 0 AFTER received_quantity",
  );
  await addColumnIfMissing(
    "customer_credit_vendor_tracking",
    "accepted_quantity",
    "INT NOT NULL DEFAULT 0 AFTER spoiled_quantity",
  );
  await addColumnIfMissing(
    "customer_credit_vendor_tracking",
    "returned_quantity",
    "INT NOT NULL DEFAULT 0 AFTER accepted_quantity",
  );
  await addColumnIfMissing(
    "customer_credit_vendor_tracking",
    "email",
    "VARCHAR(254) NULL AFTER phone",
  );
  await pool.query(`
    UPDATE customer_credit_vendor_tracking
    SET received_quantity = quantity, accepted_quantity = quantity
    WHERE received_quantity = 0 AND spoiled_quantity = 0 AND accepted_quantity = 0
  `);
  await pool.query(`
    UPDATE customer_credit_vendor_tracking
    SET accepted_quantity = GREATEST(received_quantity - spoiled_quantity, 0)
    WHERE accepted_quantity = 0 AND received_quantity > spoiled_quantity
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_vendor_spoilage_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      enterprise_id VARCHAR(64) NOT NULL,
      receiving_id VARCHAR(64) NOT NULL,
      vendor_name VARCHAR(160) NOT NULL,
      product VARCHAR(120) NULL,
      received_quantity INT NOT NULL,
      spoilage_quantity INT NOT NULL,
      accepted_quantity INT NOT NULL,
      note VARCHAR(255) NULL,
      recorded_by VARCHAR(160) NULL,
      receiving_created_at DATETIME NOT NULL,
      recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_vendor_spoilage_enterprise_date (enterprise_id, recorded_at),
      INDEX idx_vendor_spoilage_receiving (receiving_id),
      CONSTRAINT fk_vendor_spoilage_enterprise FOREIGN KEY (enterprise_id)
        REFERENCES customer_credit_enterprises(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_meat_orders (
      id VARCHAR(64) PRIMARY KEY,
      enterprise_id VARCHAR(64) NOT NULL,
      customer_name VARCHAR(160) NOT NULL,
      customer_phone VARCHAR(60) NOT NULL,
      meat_type VARCHAR(160) NOT NULL,
      quantity VARCHAR(80) NOT NULL,
      preparation_instructions VARCHAR(500) NULL,
      pickup_at DATETIME NOT NULL,
      employee_name VARCHAR(160) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      completed_at DATETIME NULL,
      completed_by VARCHAR(160) NULL,
      notification_sent_at DATETIME NULL,
      notification_provider VARCHAR(40) NULL,
      notification_channel VARCHAR(20) NULL,
      notification_message_id VARCHAR(160) NULL,
      notification_claimed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_meat_orders_enterprise_pickup (enterprise_id, pickup_at),
      CONSTRAINT fk_meat_orders_enterprise
        FOREIGN KEY (enterprise_id) REFERENCES customer_credit_enterprises(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing(
    "customer_credit_meat_orders",
    "status",
    "VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER employee_name",
  );
  await addColumnIfMissing(
    "customer_credit_meat_orders",
    "completed_at",
    "DATETIME NULL AFTER status",
  );
  await addColumnIfMissing(
    "customer_credit_meat_orders",
    "completed_by",
    "VARCHAR(160) NULL AFTER completed_at",
  );
  await addColumnIfMissing("customer_credit_meat_orders", "notification_sent_at", "DATETIME NULL AFTER completed_by");
  await addColumnIfMissing("customer_credit_meat_orders", "notification_provider", "VARCHAR(40) NULL AFTER notification_sent_at");
  await addColumnIfMissing("customer_credit_meat_orders", "notification_channel", "VARCHAR(20) NULL AFTER notification_provider");
  await addColumnIfMissing("customer_credit_meat_orders", "notification_message_id", "VARCHAR(160) NULL AFTER notification_channel");
  await addColumnIfMissing("customer_credit_meat_orders", "notification_claimed_at", "DATETIME NULL AFTER notification_message_id");
  await pool.query("UPDATE customer_credit_meat_orders SET status='pending' WHERE status='active'");
  await pool.query("UPDATE customer_credit_meat_orders SET status='picked_up' WHERE status='completed'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_meat_order_items (
      id VARCHAR(64) PRIMARY KEY,
      order_id VARCHAR(64) NOT NULL,
      enterprise_id VARCHAR(64) NOT NULL,
      product_name VARCHAR(160) NOT NULL,
      quantity DECIMAL(12,3) NOT NULL,
      unit VARCHAR(40) NOT NULL,
      special_instructions VARCHAR(500) NULL,
      price DECIMAL(12,2) NULL,
      position INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_meat_order_items_order (order_id, position),
      INDEX idx_meat_order_items_enterprise (enterprise_id),
      CONSTRAINT fk_meat_order_items_order FOREIGN KEY (order_id) REFERENCES customer_credit_meat_orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_meat_order_items_enterprise FOREIGN KEY (enterprise_id) REFERENCES customer_credit_enterprises(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    INSERT IGNORE INTO customer_credit_meat_order_items
      (id, order_id, enterprise_id, product_name, quantity, unit, special_instructions, position)
    SELECT CONCAT('legacy-', LEFT(id, 57)), id, enterprise_id, meat_type,
      COALESCE(NULLIF(CAST(quantity AS DECIMAL(12,3)), 0), 1),
      CASE WHEN LOWER(quantity) LIKE '%kg%' THEN 'kg' WHEN LOWER(quantity) LIKE '%lb%' THEN 'lb' ELSE 'item' END,
      preparation_instructions, 0 FROM customer_credit_meat_orders
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_finance_entries (
      id VARCHAR(64) PRIMARY KEY,
      enterprise_id VARCHAR(64) NOT NULL,
      entry_type ENUM('revenue', 'expense') NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      category VARCHAR(80) NOT NULL,
      payment_method VARCHAR(60) NULL,
      entry_date DATE NOT NULL,
      notes VARCHAR(500) NULL,
      receipt_name VARCHAR(180) NULL,
      receipt_type VARCHAR(80) NULL,
      receipt_data MEDIUMTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_finance_enterprise_date (enterprise_id, entry_date),
      INDEX idx_finance_enterprise_type_date (enterprise_id, entry_type, entry_date),
      CONSTRAINT fk_finance_entries_enterprise
        FOREIGN KEY (enterprise_id) REFERENCES customer_credit_enterprises(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_records (
      id VARCHAR(64) PRIMARY KEY,
      customer_name VARCHAR(160) NOT NULL,
      customer_phone VARCHAR(60) NULL,
      item_note VARCHAR(255) NOT NULL,
      credit_date DATE NOT NULL,
      credit_time TIME NULL,
      credit_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_customer_name (customer_name),
      INDEX idx_credit_date (credit_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(
    "customer_credit_records",
    "enterprise_id",
    "VARCHAR(64) NULL AFTER id",
  );
  await pool.query(
    "UPDATE customer_credit_records SET enterprise_id = ? WHERE enterprise_id IS NULL OR enterprise_id = ''",
    [defaultEnterprise.id],
  );
  await addIndexIfMissing(
    "customer_credit_records",
    "idx_customer_credit_records_enterprise_updated",
    "ADD INDEX idx_customer_credit_records_enterprise_updated (enterprise_id, updated_at)",
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_payments (
      id VARCHAR(64) PRIMARY KEY,
      record_id VARCHAR(64) NOT NULL,
      payment_date DATE NOT NULL,
      payment_time TIME NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      note VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_record_id (record_id),
      CONSTRAINT fk_customer_credit_payments_record
        FOREIGN KEY (record_id) REFERENCES customer_credit_records(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_signup_invites (
      id VARCHAR(64) PRIMARY KEY,
      code_hash CHAR(64) NOT NULL,
      created_by_user_id VARCHAR(64) NOT NULL,
      created_by_enterprise_id VARCHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      used_by_enterprise_id VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_customer_credit_signup_invite_hash (code_hash),
      INDEX idx_customer_credit_signup_invites_status (used_at, expires_at),
      INDEX idx_customer_credit_signup_invites_creator (created_by_enterprise_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_audit_log (
      id VARCHAR(64) PRIMARY KEY,
      enterprise_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NULL,
      username VARCHAR(80) NOT NULL,
      action VARCHAR(80) NOT NULL,
      entity_type VARCHAR(60) NOT NULL,
      entity_id VARCHAR(64) NULL,
      summary VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_customer_credit_audit_enterprise_created (enterprise_id, created_at),
      INDEX idx_customer_credit_audit_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_password_reset_tokens (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      enterprise_id VARCHAR(64) NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_customer_credit_password_reset_hash (token_hash),
      INDEX idx_customer_credit_password_reset_user (user_id, created_at),
      INDEX idx_customer_credit_password_reset_expiry (expires_at, used_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_email_verification_tokens (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      enterprise_id VARCHAR(64) NOT NULL,
      email VARCHAR(254) NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_customer_credit_email_verification_hash (token_hash),
      INDEX idx_customer_credit_email_verification_user (user_id, created_at),
      INDEX idx_customer_credit_email_verification_expiry (expires_at, used_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE OR REPLACE VIEW customer_credit_balances AS
    SELECT
      r.id,
      r.enterprise_id,
      r.customer_name,
      r.customer_phone,
      r.item_note,
      r.credit_date,
      r.credit_time,
      r.credit_amount,
      COALESCE(SUM(p.amount), 0.00) AS paid_amount,
      GREATEST(r.credit_amount - COALESCE(SUM(p.amount), 0.00), 0.00) AS balance_due,
      r.created_at,
      r.updated_at
    FROM customer_credit_records r
    LEFT JOIN customer_credit_payments p ON p.record_id = r.id
    GROUP BY
      r.id,
      r.enterprise_id,
      r.customer_name,
      r.customer_phone,
      r.item_note,
      r.credit_date,
      r.credit_time,
      r.credit_amount,
      r.created_at,
      r.updated_at
  `);
}

async function ensureDefaultEnterprise() {
  const enterpriseCode = config.auth.defaultEnterpriseCode;
  const enterpriseId = `ent-${crypto.createHash("sha256").update(enterpriseCode).digest("hex").slice(0, 18)}`;
  await pool.query(
    `
      INSERT INTO customer_credit_enterprises (id, code, name, status)
      VALUES (?, ?, ?, 'active')
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        status = 'active'
    `,
    [enterpriseId, enterpriseCode, config.auth.storeName],
  );

  const [users] = await pool.query(
    "SELECT id FROM customer_credit_users WHERE enterprise_id = ? AND username = ? LIMIT 1",
    [enterpriseId, config.auth.defaultUsername],
  );

  if (!users.length) {
    const passwordHash = config.auth.passwordHash || (await hashPassword(config.auth.password));
    await pool.query(
      `
        INSERT INTO customer_credit_users
          (id, enterprise_id, username, display_name, role, password_hash)
        VALUES (?, ?, ?, ?, 'owner', ?)
      `,
      [cryptoRandomId(), enterpriseId, config.auth.defaultUsername, "Owner", passwordHash],
    );
  }

  return {
    id: enterpriseId,
    code: enterpriseCode,
    name: config.auth.storeName,
  };
}

async function addColumnIfMissing(tableName, columnName, definition) {
  const [rows] = await pool.query(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [config.db.database, tableName, columnName],
  );

  if (!rows.length) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function addIndexIfMissing(tableName, indexName, alterClause) {
  const [rows] = await pool.query(
    `
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1
    `,
    [config.db.database, tableName, indexName],
  );

  if (!rows.length) {
    await pool.query(`ALTER TABLE ${tableName} ${alterClause}`);
  }
}

function isPlatformAdminSession(session) {
  return (
    session.role === "owner" &&
    session.enterpriseCode === config.auth.defaultEnterpriseCode
  );
}

async function createSignupInvite(session) {
  const rawCode = crypto.randomBytes(8).toString("hex").toUpperCase();
  const code = `NC-${rawCode.slice(0, 8)}-${rawCode.slice(8)}`;
  const inviteId = cryptoRandomId();
  const inviteDays = Math.max(1, Math.min(30, config.auth.signupInviteDays));
  const expiresAt = toMysqlDateTime(
    new Date(Date.now() + inviteDays * 24 * 60 * 60 * 1000).toISOString(),
  );

  await pool.query(
    `
      INSERT INTO customer_credit_signup_invites
        (id, code_hash, created_by_user_id, created_by_enterprise_id, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    [inviteId, hashInviteCode(code), session.userId, session.enterpriseId, expiresAt],
  );
  await recordAudit(pool, session, {
    action: "invite.created",
    entityType: "invite",
    entityId: inviteId,
    summary: "Created a registration invitation",
  });

  const [rows] = await pool.query(
    `
      SELECT
        id,
        DATE_FORMAT(expires_at, '%Y-%m-%dT%H:%i:%sZ') AS expiresAt,
        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt
      FROM customer_credit_signup_invites
      WHERE id = ?
      LIMIT 1
    `,
    [inviteId],
  );
  return { ...rows[0], code };
}

async function listSignupInvites() {
  const [rows] = await pool.query(`
    SELECT
      i.id,
      DATE_FORMAT(i.expires_at, '%Y-%m-%dT%H:%i:%sZ') AS expiresAt,
      DATE_FORMAT(i.used_at, '%Y-%m-%dT%H:%i:%sZ') AS usedAt,
      DATE_FORMAT(i.created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt,
      used_enterprise.name AS usedByEnterpriseName,
      used_enterprise.code AS usedByEnterpriseCode
    FROM customer_credit_signup_invites i
    LEFT JOIN customer_credit_enterprises used_enterprise
      ON used_enterprise.id = i.used_by_enterprise_id
    ORDER BY i.created_at DESC
    LIMIT 30
  `);
  return rows.map((row) => ({
    ...row,
    status: row.usedAt ? "used" : new Date(row.expiresAt).getTime() <= Date.now() ? "expired" : "active",
  }));
}

async function revokeSignupInvite(inviteId, session) {
  const [result] = await pool.query(
    `
      DELETE FROM customer_credit_signup_invites
      WHERE id = ? AND created_by_enterprise_id = ? AND used_at IS NULL
    `,
    [inviteId, session.enterpriseId],
  );
  if (result.affectedRows) {
    await recordAudit(pool, session, {
      action: "invite.revoked",
      entityType: "invite",
      entityId: inviteId,
      summary: "Revoked a registration invitation",
    });
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requirePlatformAdmin(session) {
  if (!isPlatformAdminSession(session)) {
    throw httpError(403, "Platform owner access required");
  }
}

function requireEnterpriseOwner(session) {
  if (session.role !== "owner") {
    throw httpError(403, "Enterprise owner access required");
  }
}

function requireOrderNotificationManager(session) {
  if (!canResendOrderNotification(session.role)) {
    throw httpError(403, "Owner or manager access required to resend notifications");
  }
}

function requireOwnerPin(session) {
  requireEnterpriseOwner(session);
  if (!hasOwnerPinAccess(session)) throw httpError(403, "Owner PIN required");
}

function requireRecordManager(session) {
  if (session.role !== "owner" && !isEmployeeRole(session.role)) {
    throw httpError(403, "This account has view-only access");
  }
}

function isEmployeeRole(role) {
  return role === "employee" || role === "staff" || role === "viewer";
}

function publicRole(role) {
  return role === "owner" ? "owner" : "employee";
}

function hasOwnerPinAccess(session) {
  return session.role === "owner" && Number(ownerPinUnlocks.get(session.userId) || 0) > Date.now();
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateAccountPassword(password) {
  const value = String(password || "");
  if (value.length < 8 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw httpError(400, "Password must be at least 8 characters and include a letter and a number");
  }
  if (value.length > 128) {
    throw httpError(400, "Password cannot be longer than 128 characters");
  }
  return value;
}

function validateAccountUsername(value) {
  const rawValue = String(value || "").trim();
  const username = normalizeUsername(rawValue);
  if (rawValue.length < 3 || username.length < 3) {
    throw httpError(400, "Username must be at least 3 characters");
  }
  return username;
}

function normalizeAuditInput(value) {
  const allowedActions = new Set([
    "credit.created",
    "credit.updated",
    "payment.added",
    "payment.undone",
  ]);
  if (!value || !allowedActions.has(value.action)) return null;
  return {
    action: value.action,
    entityType: value.action.startsWith("payment.") ? "payment" : "credit",
    entityId: String(value.entityId || "").slice(0, 64) || null,
    summary: String(value.summary || "Updated customer credit").trim().slice(0, 255),
  };
}

async function recordAudit(executor, session, event) {
  await executor.query(
    `
      INSERT INTO customer_credit_audit_log
        (id, enterprise_id, user_id, username, action, entity_type, entity_id, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      cryptoRandomId(),
      event.enterpriseId || session.enterpriseId,
      session.userId || null,
      session.username || "system",
      event.action,
      event.entityType,
      event.entityId || null,
      String(event.summary || event.action).slice(0, 255),
    ],
  );
}

async function changeOwnPassword(session, currentPassword, newPassword) {
  const password = validateAccountPassword(newPassword);
  const [users] = await pool.query(
    "SELECT password_hash AS passwordHash FROM customer_credit_users WHERE id = ? AND enterprise_id = ? LIMIT 1",
    [session.userId, session.enterpriseId],
  );
  if (!users.length || !(await passwordMatches(String(currentPassword || ""), users[0].passwordHash))) {
    throw httpError(400, "Current password is incorrect");
  }
  await pool.query(
    "UPDATE customer_credit_users SET password_hash = ?, must_change_password = 0, session_version = session_version + 1 WHERE id = ? AND enterprise_id = ?",
    [await hashPassword(password), session.userId, session.enterpriseId],
  );
  await recordAudit(pool, session, {
    action: "account.password_changed",
    entityType: "user",
    entityId: session.userId,
    summary: "Changed account password",
  });
  return Number(session.sessionVersion || 1) + 1;
}

async function updateOwnRecoveryEmail(session, value) {
  if (!config.email.apiKey) throw httpError(503, "Automatic email recovery is not enabled");
  const email = normalizeEmail(value);
  if (!isValidEmail(email)) throw httpError(400, "Enter a valid recovery email address");
  try {
    await pool.query(
      `
        UPDATE customer_credit_users
        SET email = ?, email_verified_at = NULL
        WHERE id = ? AND enterprise_id = ?
      `,
      [email, session.userId, session.enterpriseId],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw httpError(409, "That email is already used by another account");
    }
    throw error;
  }
  await sendEmailVerification({
    enterpriseId: session.enterpriseId,
    enterpriseName: session.enterpriseName,
    userId: session.userId,
    username: session.username,
    email,
  });
  await recordAudit(pool, session, {
    action: "account.email_updated",
    entityType: "user",
    entityId: session.userId,
    summary: "Updated recovery email",
  });
  return email;
}

async function resendOwnEmailVerification(session) {
  if (!config.email.apiKey) throw httpError(503, "Automatic email recovery is not enabled");
  const [rows] = await pool.query(
    `
      SELECT email, email_verified_at AS emailVerifiedAt
      FROM customer_credit_users
      WHERE id = ? AND enterprise_id = ?
      LIMIT 1
    `,
    [session.userId, session.enterpriseId],
  );
  if (!rows.length || !rows[0].email) throw httpError(400, "Add a recovery email first");
  if (rows[0].emailVerifiedAt) throw httpError(400, "Recovery email is already verified");
  await sendEmailVerification({
    enterpriseId: session.enterpriseId,
    enterpriseName: session.enterpriseName,
    userId: session.userId,
    username: session.username,
    email: rows[0].email,
  });
}

async function listEnterpriseUsers(enterpriseId) {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        username,
        display_name AS displayName,
        role,
        must_change_password AS mustChangePassword,
        email || null,
        email_verified_at AS emailVerifiedAt,
        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt
      FROM customer_credit_users
      WHERE enterprise_id = ?
      ORDER BY FIELD(role, 'owner', 'staff', 'viewer'), display_name, username
    `,
    [enterpriseId],
  );
  return rows.map((row) => ({
    ...row,
    role: publicRole(row.role),
    mustChangePassword: Boolean(row.mustChangePassword),
    emailVerified: Boolean(row.emailVerifiedAt),
  }));
}

async function createEnterpriseUser(session, body) {
  const username = validateAccountUsername(body.username);
  const displayName = String(body.displayName || "").trim().slice(0, 160);
  const role = "staff";
  const password = validateAccountPassword(body.password);
  const email = config.email.apiKey ? normalizeEmail(body.email) : "";
  if (config.email.apiKey && !isValidEmail(email)) {
    throw httpError(400, "Enter a valid recovery email address");
  }
  if (displayName.length < 2) {
    throw httpError(400, "Display name must be at least 2 characters");
  }
  const userId = cryptoRandomId();
  try {
    await pool.query(
      `
        INSERT INTO customer_credit_users
          (id, enterprise_id, username, display_name, role, password_hash, must_change_password, email)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `,
      [
        userId,
        session.enterpriseId,
        username,
        displayName,
        role,
        await hashPassword(password),
        email,
      ],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "That username is already in use");
    throw error;
  }
  await recordAudit(pool, session, {
    action: "user.created",
    entityType: "user",
    entityId: userId,
    summary: `Created ${role} account ${username}`,
  });
  try {
    await sendEmailVerification({
      enterpriseId: session.enterpriseId,
      enterpriseName: session.enterpriseName,
      userId,
      username,
      email,
    });
  } catch (error) {
    console.error(`Could not send staff verification email: ${error.message}`);
  }
  return (await listEnterpriseUsers(session.enterpriseId)).find((user) => user.id === userId);
}

async function updateEnterpriseUser(session, userId, body) {
  const [rows] = await pool.query(
    `
      SELECT id, username, display_name AS displayName, role, email
      FROM customer_credit_users
      WHERE id = ? AND enterprise_id = ?
      LIMIT 1
    `,
    [userId, session.enterpriseId],
  );
  const existing = rows[0];
  if (!existing) throw httpError(404, "User account not found");
  if (existing.role === "owner") throw httpError(400, "The owner account is managed separately");

  const username = body.username ? validateAccountUsername(body.username) : existing.username;
  const displayName = body.displayName
    ? String(body.displayName).trim().slice(0, 160)
    : existing.displayName;
  const role = "staff";
  const email = config.email.apiKey && body.email ? normalizeEmail(body.email) : existing.email;
  if (config.email.apiKey && !isValidEmail(email)) {
    throw httpError(400, "Enter a valid recovery email address");
  }
  const emailChanged = email !== existing.email;
  const passwordHash = body.password
    ? await hashPassword(validateAccountPassword(body.password))
    : null;

  try {
    await pool.query(
      `
        UPDATE customer_credit_users
        SET
          username = ?,
          display_name = ?,
          role = ?,
          email = ?,
          email_verified_at = CASE WHEN ? THEN NULL ELSE email_verified_at END,
          password_hash = COALESCE(?, password_hash),
          must_change_password = CASE WHEN ? IS NULL THEN must_change_password ELSE 1 END,
          session_version = CASE WHEN ? IS NULL THEN session_version ELSE session_version + 1 END
        WHERE id = ? AND enterprise_id = ?
      `,
      [
        username,
        displayName,
        role,
        email,
        emailChanged,
        passwordHash,
        passwordHash,
        passwordHash,
        userId,
        session.enterpriseId,
      ],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "That username is already in use");
    throw error;
  }
  await recordAudit(pool, session, {
    action: "user.updated",
    entityType: "user",
    entityId: userId,
    summary: `Updated ${username} (${role})`,
  });
  if (emailChanged) {
    try {
      await sendEmailVerification({
        enterpriseId: session.enterpriseId,
        enterpriseName: session.enterpriseName,
        userId,
        username,
        email,
      });
    } catch (error) {
      console.error(`Could not send staff verification email: ${error.message}`);
    }
  }
  return (await listEnterpriseUsers(session.enterpriseId)).find((user) => user.id === userId);
}

async function deleteEnterpriseUser(session, userId) {
  if (userId === session.userId) throw httpError(400, "You cannot remove your own account");
  const [rows] = await pool.query(
    "SELECT username, role FROM customer_credit_users WHERE id = ? AND enterprise_id = ? LIMIT 1",
    [userId, session.enterpriseId],
  );
  if (!rows.length) throw httpError(404, "User account not found");
  if (rows[0].role === "owner") throw httpError(400, "The owner account cannot be removed");
  await pool.query(
    "DELETE FROM customer_credit_users WHERE id = ? AND enterprise_id = ?",
    [userId, session.enterpriseId],
  );
  await recordAudit(pool, session, {
    action: "user.removed",
    entityType: "user",
    entityId: userId,
    summary: `Removed user ${rows[0].username}`,
  });
}

async function listEnterpriseActivity(enterpriseId) {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        username,
        action,
        entity_type AS entityType,
        entity_id AS entityId,
        summary,
        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt
      FROM customer_credit_audit_log
      WHERE enterprise_id = ?
      ORDER BY created_at DESC
      LIMIT 150
    `,
    [enterpriseId],
  );
  return rows;
}

async function listManagedEnterprises() {
  const [rows] = await pool.query(
    `
      SELECT
        e.id,
        e.code,
        e.name,
        e.status,
        owner_user.username AS ownerUsername,
        owner_user.email AS ownerEmail,
        owner_user.email_verified_at AS ownerEmailVerifiedAt,
        COUNT(DISTINCT users.id) AS userCount,
        COUNT(DISTINCT records.id) AS recordCount,
        DATE_FORMAT(e.created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt
      FROM customer_credit_enterprises e
      LEFT JOIN customer_credit_users owner_user
        ON owner_user.enterprise_id = e.id AND owner_user.role = 'owner'
      LEFT JOIN customer_credit_users users ON users.enterprise_id = e.id
      LEFT JOIN customer_credit_records records ON records.enterprise_id = e.id
      WHERE e.code <> ?
      GROUP BY e.id, e.code, e.name, e.status, owner_user.username, owner_user.email, owner_user.email_verified_at, e.created_at
      ORDER BY e.created_at DESC
    `,
    [config.auth.defaultEnterpriseCode],
  );
  return rows.map((row) => ({
    ...row,
    ownerEmailVerified: Boolean(row.ownerEmailVerifiedAt),
  }));
}

async function getAdminSummary() {
  const [[enterpriseCounts], [userCounts], [recordCounts], [inviteCounts]] =
    await Promise.all([
      pool.query(
        `
          SELECT
            SUM(status = 'active') AS activeEnterprises,
            SUM(status = 'disabled') AS disabledEnterprises
          FROM customer_credit_enterprises
          WHERE code <> ?
        `,
        [config.auth.defaultEnterpriseCode],
      ),
      pool.query(
        `
          SELECT COUNT(*) AS managedUsers
          FROM customer_credit_users users
          INNER JOIN customer_credit_enterprises enterprises ON enterprises.id = users.enterprise_id
          WHERE enterprises.code <> ?
        `,
        [config.auth.defaultEnterpriseCode],
      ),
      pool.query(
        `
          SELECT COUNT(*) AS managedRecords
          FROM customer_credit_records records
          INNER JOIN customer_credit_enterprises enterprises ON enterprises.id = records.enterprise_id
          WHERE enterprises.code <> ?
        `,
        [config.auth.defaultEnterpriseCode],
      ),
      pool.query(
        `
          SELECT COUNT(*) AS activeInvites
          FROM customer_credit_signup_invites
          WHERE used_at IS NULL AND expires_at > UTC_TIMESTAMP()
        `,
      ),
    ]);
  return {
    activeEnterprises: Number(enterpriseCounts[0]?.activeEnterprises || 0),
    disabledEnterprises: Number(enterpriseCounts[0]?.disabledEnterprises || 0),
    managedUsers: Number(userCounts[0]?.managedUsers || 0),
    managedRecords: Number(recordCounts[0]?.managedRecords || 0),
    activeInvites: Number(inviteCounts[0]?.activeInvites || 0),
  };
}

async function listManagedEnterpriseUsers(enterpriseId) {
  const [rows] = await pool.query(
    `
      SELECT
        users.id,
        users.username,
        users.display_name AS displayName,
        users.role,
        users.must_change_password AS mustChangePassword,
        users.email,
        users.email_verified_at AS emailVerifiedAt,
        enterprises.id AS enterpriseId,
        enterprises.code AS enterpriseCode,
        enterprises.name AS enterpriseName
      FROM customer_credit_users users
      INNER JOIN customer_credit_enterprises enterprises ON enterprises.id = users.enterprise_id
      WHERE enterprises.id = ? AND enterprises.code <> ?
      ORDER BY FIELD(users.role, 'owner', 'staff', 'viewer'), users.display_name
    `,
    [enterpriseId, config.auth.defaultEnterpriseCode],
  );
  return rows.map((row) => ({
    ...row,
    mustChangePassword: Boolean(row.mustChangePassword),
    emailVerified: Boolean(row.emailVerifiedAt),
  }));
}

async function resetManagedUserAccess(session, userId, body) {
  const [rows] = await pool.query(
    `
      SELECT
        users.id,
        users.enterprise_id AS enterpriseId,
        users.username,
        users.display_name AS displayName,
        users.role,
        enterprises.code AS enterpriseCode
      FROM customer_credit_users users
      INNER JOIN customer_credit_enterprises enterprises ON enterprises.id = users.enterprise_id
      WHERE users.id = ? AND enterprises.code <> ?
      LIMIT 1
    `,
    [userId, config.auth.defaultEnterpriseCode],
  );
  const user = rows[0];
  if (!user) throw httpError(404, "Managed user not found");
  const username = validateAccountUsername(body.username || user.username);
  const password = validateAccountPassword(body.temporaryPassword);
  try {
    await pool.query(
      `
        UPDATE customer_credit_users
        SET
          username = ?,
          password_hash = ?,
          must_change_password = 1,
          session_version = session_version + 1
        WHERE id = ? AND enterprise_id = ?
      `,
      [username, await hashPassword(password), user.id, user.enterpriseId],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "That username is already in use");
    throw error;
  }
  await recordAudit(pool, session, {
    action: "user.access_reset_by_platform",
    entityType: "user",
    entityId: user.id,
    summary: `Reset ${user.enterpriseCode} user ${username}`,
  });
  return { ...user, username, mustChangePassword: true };
}

async function getManagedEnterprise(enterpriseId) {
  return (await listManagedEnterprises()).find((enterprise) => enterprise.id === enterpriseId) || null;
}

async function resetEnterpriseAccess(session, enterpriseId, body) {
  const enterprise = await getManagedEnterprise(enterpriseId);
  if (!enterprise) throw httpError(404, "Enterprise not found");
  const username = validateAccountUsername(body.username || enterprise.ownerUsername);
  const password = validateAccountPassword(body.temporaryPassword);
  const [owners] = await pool.query(
    `
      SELECT id
      FROM customer_credit_users
      WHERE enterprise_id = ? AND role = 'owner'
      ORDER BY created_at
      LIMIT 1
    `,
    [enterpriseId],
  );
  if (!owners.length) throw httpError(404, "Enterprise owner account not found");
  try {
    await pool.query(
      `
        UPDATE customer_credit_users
        SET username = ?, password_hash = ?, must_change_password = 1, session_version = session_version + 1
        WHERE id = ? AND enterprise_id = ?
      `,
      [username, await hashPassword(password), owners[0].id, enterpriseId],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "That username is already in use");
    throw error;
  }
  await recordAudit(pool, session, {
    action: "enterprise.access_reset",
    entityType: "enterprise",
    entityId: enterpriseId,
    summary: `Reset access for ${enterprise.code}`,
  });
  return { ...(await getManagedEnterprise(enterpriseId)), ownerUsername: username };
}

async function updateEnterpriseStatus(session, enterpriseId, status) {
  if (status !== "active" && status !== "disabled") {
    throw httpError(400, "Status must be active or disabled");
  }
  const enterprise = await getManagedEnterprise(enterpriseId);
  if (!enterprise) throw httpError(404, "Enterprise not found");
  await pool.query("UPDATE customer_credit_enterprises SET status = ? WHERE id = ?", [
    status,
    enterpriseId,
  ]);
  await recordAudit(pool, session, {
    action: `enterprise.${status}`,
    entityType: "enterprise",
    entityId: enterpriseId,
    summary: `${status === "active" ? "Enabled" : "Disabled"} ${enterprise.code}`,
  });
  return getManagedEnterprise(enterpriseId);
}

async function deleteManagedEnterprise(session, enterpriseId, confirmCode) {
  const enterprise = await getManagedEnterprise(enterpriseId);
  if (!enterprise) throw httpError(404, "Enterprise not found");
  if (String(confirmCode || "").trim().toLowerCase() !== enterprise.code) {
    throw httpError(400, "Enterprise code confirmation does not match");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await recordAudit(connection, session, {
      action: "enterprise.removed",
      entityType: "enterprise",
      entityId: enterpriseId,
      summary: `Removed enterprise ${enterprise.code}`,
    });
    await connection.query(
      `
        DELETE payments
        FROM customer_credit_payments payments
        INNER JOIN customer_credit_records records ON records.id = payments.record_id
        WHERE records.enterprise_id = ?
      `,
      [enterpriseId],
    );
    await connection.query("DELETE FROM customer_credit_records WHERE enterprise_id = ?", [
      enterpriseId,
    ]);
    await connection.query("DELETE FROM customer_credit_products WHERE enterprise_id = ?", [
      enterpriseId,
    ]);
    await connection.query("DELETE FROM customer_credit_vendor_tracking WHERE enterprise_id = ?", [
      enterpriseId,
    ]);
    await connection.query(
      "DELETE FROM customer_credit_signup_invites WHERE created_by_enterprise_id = ? OR used_by_enterprise_id = ?",
      [enterpriseId, enterpriseId],
    );
    await connection.query("DELETE FROM customer_credit_audit_log WHERE enterprise_id = ?", [
      enterpriseId,
    ]);
    await connection.query(
      "DELETE FROM customer_credit_password_reset_tokens WHERE enterprise_id = ?",
      [enterpriseId],
    );
    await connection.query(
      "DELETE FROM customer_credit_email_verification_tokens WHERE enterprise_id = ?",
      [enterpriseId],
    );
    await connection.query("DELETE FROM customer_credit_users WHERE enterprise_id = ?", [
      enterpriseId,
    ]);
    await connection.query("DELETE FROM customer_credit_enterprises WHERE id = ?", [enterpriseId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listProducts(enterpriseId) {
  const [products] = await pool.query(`
    SELECT
      id,
      name,
      price,
      barcode,
      quantity,
      label_size AS labelSize,
      DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
      DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s') AS updatedAt
    FROM customer_credit_products
    WHERE enterprise_id = ?
    ORDER BY updated_at DESC, created_at DESC
  `, [enterpriseId]);

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    price: Number(product.price || 0),
    barcode: product.barcode,
    quantity: validProductQuantity(product.quantity),
    labelSize: product.labelSize || "medium",
    createdAt: toIsoLike(product.createdAt),
    updatedAt: toIsoLike(product.updatedAt),
  }));
}

async function upsertProduct(enterpriseId, product) {
  const [barcodeMatches] = await pool.query(
    `
      SELECT id
      FROM customer_credit_products
      WHERE enterprise_id = ? AND barcode = ?
      LIMIT 1
    `,
    [enterpriseId, product.barcode],
  );
  const productId = barcodeMatches[0]?.id || product.id;

  await pool.query(
    `
      INSERT INTO customer_credit_products
        (id, enterprise_id, name, price, barcode, quantity, label_size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        price = VALUES(price),
        barcode = VALUES(barcode),
        quantity = VALUES(quantity),
        label_size = VALUES(label_size),
        updated_at = VALUES(updated_at)
    `,
    [
      productId,
      enterpriseId,
      product.name,
      product.price,
      product.barcode,
      product.quantity,
      product.labelSize,
      toMysqlDateTime(product.createdAt),
      toMysqlDateTime(product.updatedAt),
    ],
  );

  const [rows] = await pool.query(
    `
      SELECT
        id,
        name,
        price,
        barcode,
        quantity,
        label_size AS labelSize,
        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
        DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s') AS updatedAt
      FROM customer_credit_products
      WHERE enterprise_id = ? AND id = ?
      LIMIT 1
    `,
    [enterpriseId, productId],
  );
  const saved = rows[0];
  return {
    id: saved.id,
    name: saved.name,
    price: Number(saved.price || 0),
    barcode: saved.barcode,
    quantity: validProductQuantity(saved.quantity),
    labelSize: saved.labelSize || "medium",
    createdAt: toIsoLike(saved.createdAt),
    updatedAt: toIsoLike(saved.updatedAt),
  };
}

async function deleteProduct(session, productId) {
  const [products] = await pool.query(
    "SELECT name FROM customer_credit_products WHERE id = ? AND enterprise_id = ? LIMIT 1",
    [productId, session.enterpriseId],
  );
  const [result] = await pool.query(
    "DELETE FROM customer_credit_products WHERE id = ? AND enterprise_id = ?",
    [productId, session.enterpriseId],
  );
  if (result.affectedRows) {
    await recordAudit(pool, session, {
      action: "product.deleted",
      entityType: "product",
      entityId: productId,
      summary: `Deleted product ${products[0]?.name || productId}`,
    });
  }
}

async function listVendors(enterpriseId) {
  const [vendors] = await pool.query(`
    SELECT
      id,
      vendor_account_id AS vendorAccountId,
      vendor_name AS vendorName,
      contact_name AS contactName,
      quantity,
      unit,
      received_quantity AS receivedQuantity,
      spoiled_quantity AS spoiledQuantity,
      accepted_quantity AS acceptedQuantity,
      returned_quantity AS returnedQuantity,
      phone,
      email,
      reference,
      amount,
      DATE_FORMAT(due_date, '%Y-%m-%d') AS dueDate,
      status,
      note,
      DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
      DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s') AS updatedAt
    FROM customer_credit_vendor_tracking
    WHERE enterprise_id = ?
    ORDER BY updated_at DESC, created_at DESC
  `, [enterpriseId]);

  return vendors.map((vendor) => ({
    id: vendor.id,
    vendorAccountId: vendor.vendorAccountId || "",
    vendorName: vendor.vendorName,
    contactName: vendor.contactName || "",
    quantity: validVendorQuantity(vendor.quantity),
    unit: vendor.unit || "piece",
    receivedQuantity: validVendorCount(vendor.receivedQuantity),
    spoiledQuantity: validVendorCount(vendor.spoiledQuantity),
    acceptedQuantity: validVendorCount(vendor.acceptedQuantity),
    returnedQuantity: validVendorCount(vendor.returnedQuantity),
    phone: vendor.phone || "",
    email: vendor.email || "",
    reference: vendor.reference || "",
    amount: Number(vendor.amount || 0),
    price: Number(vendor.amount || 0),
    dueDate: vendor.dueDate || "",
    status: validVendorStatus(vendor.status),
    note: vendor.note || "",
    createdAt: toIsoLike(vendor.createdAt),
    updatedAt: toIsoLike(vendor.updatedAt),
  }));
}

async function listVendorAccounts(enterpriseId) {
  const [rows] = await pool.query(`
    SELECT id, vendor_name AS vendorName, phone, email, status,
      DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt
    FROM customer_credit_vendor_accounts
    WHERE enterprise_id = ?
    ORDER BY vendor_name, created_at
  `, [enterpriseId]);
  return rows.map((row) => ({ ...row, phone: row.phone || "", email: row.email || "",
    createdAt: toIsoLike(row.createdAt) }));
}

async function createVendorAccount(session, body) {
  const vendorName = requiredString(body.vendorName || body.name, "Vendor name").slice(0, 160);
  const phone = String(body.phone || "").trim().slice(0, 60);
  const email = normalizeVendorEmail(body.email).slice(0, 254);
  const phoneNormalized = normalizeVendorPhone(phone);
  if (!phoneNormalized && !email) throw httpError(400, "A phone number or email is required for vendor login");
  if (email && !isValidEmail(email)) throw httpError(400, "Enter a valid vendor email address");

  const [existingRows] = await pool.query(`
    SELECT id FROM customer_credit_vendor_accounts
    WHERE enterprise_id = ? AND ((? <> '' AND phone_normalized = ?) OR (? <> '' AND email_normalized = ?))
    LIMIT 1
  `, [session.enterpriseId, phoneNormalized, phoneNormalized, email, email]);
  if (existingRows.length) {
    const id = existingRows[0].id;
    await pool.query(`UPDATE customer_credit_vendor_accounts
      SET vendor_name = ?, phone = ?, phone_normalized = NULLIF(?, ''), email = ?, email_normalized = NULLIF(?, '')
      WHERE id = ? AND enterprise_id = ?`,
    [vendorName, phone || null, phoneNormalized, email || null, email, id, session.enterpriseId]);
    return { created: false, vendor: (await listVendorAccounts(session.enterpriseId)).find((item) => item.id === id) };
  }

  const temporaryPassword = createTemporaryVendorPassword();
  const id = cryptoRandomId();
  await pool.query(`INSERT INTO customer_credit_vendor_accounts
    (id, enterprise_id, vendor_name, phone, phone_normalized, email, email_normalized, password_hash)
    VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?)`,
  [id, session.enterpriseId, vendorName, phone || null, phoneNormalized, email || null, email,
    await hashPassword(temporaryPassword)]);
  await pool.query(`UPDATE customer_credit_vendor_tracking SET vendor_account_id = ?
    WHERE enterprise_id = ? AND vendor_account_id IS NULL AND LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))`,
  [id, session.enterpriseId, vendorName]);
  await recordAudit(pool, session, { action: "vendor.account_created", entityType: "vendor_account",
    entityId: id, summary: `Created portal login for ${vendorName}` });
  return { created: true, temporaryPassword,
    vendor: (await listVendorAccounts(session.enterpriseId)).find((item) => item.id === id) };
}

async function getVendorPortalData(session) {
  const [rows] = await pool.query(`
    SELECT enterprise_id AS enterpriseId, vendor_account_id AS vendorAccountId, id,
      reference AS product, unit, received_quantity AS receivedQuantity,
      spoiled_quantity AS spoilageQuantity, accepted_quantity AS acceptedQuantity,
      amount AS unitPrice, status, note,
      DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
      DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s') AS updatedAt
    FROM customer_credit_vendor_tracking
    WHERE enterprise_id = ? AND vendor_account_id = ?
    ORDER BY created_at DESC, id DESC
  `, [session.enterpriseId, session.vendorAccountId]);
  const deliveries = rows.map((row) => ({
    id: row.id, product: row.product || "Unspecified product", unit: row.unit || "piece",
    receivedQuantity: Number(row.receivedQuantity || 0), spoilageQuantity: Number(row.spoilageQuantity || 0),
    acceptedQuantity: Number(row.acceptedQuantity || 0), unitPrice: Number(row.unitPrice || 0),
    amount: Number(row.acceptedQuantity || 0) * Number(row.unitPrice || 0), status: row.status,
    note: row.note || "", createdAt: toIsoLike(row.createdAt), updatedAt: toIsoLike(row.updatedAt),
  }));
  const summary = calculateVendorPortalSummary(deliveries);
  const paymentHistory = deliveries.filter((row) => row.status === "paid").map((row) => ({
    receivingId: row.id, product: row.product, amount: row.amount, paidAt: row.updatedAt,
  }));
  const monthlyMap = new Map();
  for (const row of deliveries) {
    const month = row.createdAt.slice(0, 7);
    if (!monthlyMap.has(month)) monthlyMap.set(month, { month, received: 0, spoilage: 0, accepted: 0,
      amountOwed: 0, paidAmount: 0, unpaidBalance: 0 });
    const item = monthlyMap.get(month);
    item.received += row.receivedQuantity;
    item.spoilage += row.spoilageQuantity;
    item.accepted += row.acceptedQuantity;
    item.amountOwed += row.amount;
    if (row.status === "paid") item.paidAmount += row.amount;
    else item.unpaidBalance += row.amount;
  }
  return {
    store: { code: session.enterpriseCode, name: session.enterpriseName },
    vendor: { id: session.vendorAccountId, name: session.vendorName },
    summary,
    deliveries,
    paymentHistory,
    monthlyStatements: [...monthlyMap.values()].sort((a, b) => b.month.localeCompare(a.month)),
  };
}

async function changeVendorPassword(session, currentPassword, newPassword) {
  const password = validateAccountPassword(newPassword);
  const [accounts] = await pool.query(`SELECT password_hash AS passwordHash, session_version AS sessionVersion
    FROM customer_credit_vendor_accounts WHERE id = ? AND enterprise_id = ? LIMIT 1`,
  [session.vendorAccountId, session.enterpriseId]);
  if (!accounts.length || !(await passwordMatches(String(currentPassword || ""), accounts[0].passwordHash))) {
    throw httpError(400, "Current password is incorrect");
  }
  const sessionVersion = Number(accounts[0].sessionVersion || 1) + 1;
  await pool.query(`UPDATE customer_credit_vendor_accounts
    SET password_hash = ?, session_version = ?, updated_at = ? WHERE id = ? AND enterprise_id = ?`,
  [await hashPassword(password), sessionVersion, toMysqlDateTime(new Date().toISOString()),
    session.vendorAccountId, session.enterpriseId]);
  await recordAudit(pool, { ...session, username: session.vendorName }, {
    action: "vendor.password_changed", entityType: "vendor_account",
    entityId: session.vendorAccountId, summary: "Vendor changed portal password",
  });
  return sessionVersion;
}

function createTemporaryVendorPassword() {
  return `V${crypto.randomBytes(8).toString("base64url")}7`;
}

async function listVendorSpoilageHistory(enterpriseId) {
  const [rows] = await pool.query(`
    SELECT id, receiving_id AS receivingId, vendor_name AS vendorName, product,
      received_quantity AS receivedQuantity, spoilage_quantity AS spoilageQuantity,
      accepted_quantity AS acceptedQuantity, note, recorded_by AS recordedBy,
      DATE_FORMAT(receiving_created_at, '%Y-%m-%dT%H:%i:%s') AS receivingCreatedAt,
      DATE_FORMAT(recorded_at, '%Y-%m-%dT%H:%i:%s') AS recordedAt
    FROM customer_credit_vendor_spoilage_history
    WHERE enterprise_id = ?
    ORDER BY recorded_at DESC, id DESC
  `, [enterpriseId]);
  return rows.map((row) => ({
    ...row,
    receivedQuantity: validVendorCount(row.receivedQuantity),
    spoilageQuantity: validVendorCount(row.spoilageQuantity),
    acceptedQuantity: validVendorCount(row.acceptedQuantity),
    note: row.note || "",
    recordedBy: row.recordedBy || "",
    receivingCreatedAt: toIsoLike(row.receivingCreatedAt),
    recordedAt: toIsoLike(row.recordedAt),
  }));
}

async function listMeatOrders(enterpriseId) {
  const [orders] = await pool.query(
    `
      SELECT
        id,
        customer_name AS customerName,
        customer_phone AS customerPhone,
        meat_type AS meatType,
        quantity,
        preparation_instructions AS preparationInstructions,
        DATE_FORMAT(pickup_at, '%Y-%m-%dT%H:%i:%s') AS pickupAt,
        employee_name AS employeeName,
        status,
        DATE_FORMAT(completed_at, '%Y-%m-%dT%H:%i:%s') AS completedAt,
        completed_by AS completedBy,
        DATE_FORMAT(notification_sent_at, '%Y-%m-%dT%H:%i:%s') AS notificationSentAt,
        notification_provider AS notificationProvider,
        notification_channel AS notificationChannel,
        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
        status <> 'picked_up' AS isActive
      FROM customer_credit_meat_orders
      WHERE enterprise_id = ?
      ORDER BY pickup_at ASC, created_at DESC
    `,
    [enterpriseId],
  );
  const [itemRows] = await pool.query(`
    SELECT id, order_id AS orderId, product_name AS productName, quantity, unit,
      special_instructions AS specialInstructions, price, position
    FROM customer_credit_meat_order_items WHERE enterprise_id = ?
    ORDER BY order_id, position, created_at
  `, [enterpriseId]);
  const itemsByOrder = new Map();
  for (const item of itemRows) {
    if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
    itemsByOrder.get(item.orderId).push({ id: item.id, productName: item.productName,
      quantity: Number(item.quantity), unit: item.unit, specialInstructions: item.specialInstructions || "",
      price: item.price == null ? null : Number(item.price) });
  }
  return orders.map((order) => ({
    ...order,
    preparationInstructions: order.preparationInstructions || "",
    pickupAt: toIsoLike(order.pickupAt),
    createdAt: toIsoLike(order.createdAt),
    completedAt: order.completedAt ? toIsoLike(order.completedAt) : null,
    completedBy: order.completedBy || "",
    notificationSentAt: order.notificationSentAt ? toIsoLike(order.notificationSentAt) : null,
    isActive: Boolean(order.isActive),
    items: itemsByOrder.get(order.id) || [{ id: `legacy-${order.id}`, productName: order.meatType,
      quantity: order.quantity, unit: "item", specialInstructions: order.preparationInstructions || "", price: null }],
  }));
}

async function createMeatOrder(enterpriseId, order) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
    `
      INSERT INTO customer_credit_meat_orders
        (id, enterprise_id, customer_name, customer_phone, meat_type, quantity,
         preparation_instructions, pickup_at, employee_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      order.id,
      enterpriseId,
      order.customerName,
      order.customerPhone,
      order.items[0].productName,
      `${order.items[0].quantity} ${order.items[0].unit}`,
      order.preparationInstructions || null,
      toMysqlDateTime(order.pickupAt),
      order.employeeName,
      toMysqlDateTime(order.createdAt),
    ],
    );
    await insertMeatOrderItems(connection, enterpriseId, order.id, order.items);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  return (await listMeatOrders(enterpriseId)).find((item) => item.id === order.id);
}

async function insertMeatOrderItems(connection, enterpriseId, orderId, items) {
  for (let position = 0; position < items.length; position += 1) {
    const item = items[position];
    await connection.query(`INSERT INTO customer_credit_meat_order_items
      (id, order_id, enterprise_id, product_name, quantity, unit, special_instructions, price, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [item.id, orderId, enterpriseId, item.productName,
      item.quantity, item.unit, item.specialInstructions || null, item.price, position]);
  }
}

async function updateMeatOrder(enterpriseId, orderId, order) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(`UPDATE customer_credit_meat_orders SET
      customer_name=?, customer_phone=?, meat_type=?, quantity=?, preparation_instructions=?, pickup_at=?, employee_name=?
      WHERE enterprise_id=? AND id=?`, [order.customerName, order.customerPhone, order.items[0].productName,
      `${order.items[0].quantity} ${order.items[0].unit}`, order.preparationInstructions || null,
      toMysqlDateTime(order.pickupAt), order.employeeName, enterpriseId, orderId]);
    if (!result.affectedRows) { await connection.rollback(); return null; }
    await connection.query("DELETE FROM customer_credit_meat_order_items WHERE enterprise_id=? AND order_id=?", [enterpriseId, orderId]);
    await insertMeatOrderItems(connection, enterpriseId, orderId, order.items);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  return (await listMeatOrders(enterpriseId)).find((item) => item.id === orderId);
}

async function setMeatOrderStatus(enterpriseId, orderId, status, completedBy) {
  const [result] = await pool.query(
    `
      UPDATE customer_credit_meat_orders
      SET status = ?,
          completed_at = CASE WHEN ? = 'picked_up' THEN UTC_TIMESTAMP() ELSE NULL END,
          completed_by = CASE WHEN ? = 'picked_up' THEN ? ELSE NULL END
      WHERE enterprise_id = ? AND id = ?
    `,
    [status, status, status, completedBy, enterpriseId, orderId],
  );
  if (!result.affectedRows) return null;
  return (await listMeatOrders(enterpriseId)).find((item) => item.id === orderId);
}

async function sendReadyNotification(enterpriseId, orderId, allowResend) {
  let order = (await listMeatOrders(enterpriseId)).find((item) => item.id === orderId);
  if (!order) throw httpError(404, "Order not found");
  if (order.status !== "ready") throw httpError(409, "Only ready orders can send a ready notification");
  if (order.notificationSentAt && !allowResend) return { order, delivery: null };
  if (!allowResend) {
    const [claim] = await pool.query(`UPDATE customer_credit_meat_orders SET notification_claimed_at=UTC_TIMESTAMP()
      WHERE enterprise_id=? AND id=? AND notification_sent_at IS NULL
        AND (notification_claimed_at IS NULL OR notification_claimed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))`,
    [enterpriseId, orderId]);
    if (!claim.affectedRows) {
      order = (await listMeatOrders(enterpriseId)).find((item) => item.id === orderId);
      return { order, delivery: null };
    }
  }
  try {
    const delivery = await orderNotificationService.sendOrderReady(order);
    await pool.query(`UPDATE customer_credit_meat_orders SET notification_sent_at=UTC_TIMESTAMP(),
      notification_provider=?, notification_channel=?, notification_message_id=?, notification_claimed_at=NULL
      WHERE enterprise_id=? AND id=?`, [delivery.provider, delivery.channel, delivery.messageId, enterpriseId, orderId]);
    return { order: (await listMeatOrders(enterpriseId)).find((item) => item.id === orderId), delivery };
  } catch (error) {
    if (!allowResend) await pool.query(`UPDATE customer_credit_meat_orders SET notification_claimed_at=NULL
      WHERE enterprise_id=? AND id=? AND notification_sent_at IS NULL`, [enterpriseId, orderId]);
    throw error;
  }
}

async function listFinanceEntries(enterpriseId, requestedType) {
  const entryType = ["revenue", "expense"].includes(requestedType) ? requestedType : null;
  const [entries] = await pool.query(
    `
      SELECT
        id,
        entry_type AS entryType,
        amount,
        category,
        payment_method AS paymentMethod,
        DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate,
        notes,
        receipt_name AS receiptName,
        receipt_type AS receiptType,
        receipt_data AS receiptData,
        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
        DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s') AS updatedAt
      FROM customer_credit_finance_entries
      WHERE enterprise_id = ? AND (? IS NULL OR entry_type = ?)
      ORDER BY entry_date DESC, created_at DESC
      LIMIT 5000
    `,
    [enterpriseId, entryType, entryType],
  );
  return entries.map(mapFinanceEntry);
}

async function createFinanceEntry(enterpriseId, entry) {
  await pool.query(
    `
      INSERT INTO customer_credit_finance_entries
        (id, enterprise_id, entry_type, amount, category, payment_method, entry_date,
         notes, receipt_name, receipt_type, receipt_data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      entry.id, enterpriseId, entry.entryType, entry.amount, entry.category,
      entry.paymentMethod || null, entry.entryDate, entry.notes || null,
      entry.receiptName || null, entry.receiptType || null, entry.receiptData || null,
      toMysqlDateTime(entry.createdAt), toMysqlDateTime(entry.updatedAt),
    ],
  );
  return (await listFinanceEntries(enterpriseId)).find((item) => item.id === entry.id);
}

async function updateFinanceEntry(enterpriseId, entryId, entry) {
  const [result] = await pool.query(
    `
      UPDATE customer_credit_finance_entries
      SET entry_type = ?, amount = ?, category = ?, payment_method = ?, entry_date = ?,
          notes = ?, receipt_name = ?, receipt_type = ?, receipt_data = ?, updated_at = ?
      WHERE id = ? AND enterprise_id = ?
    `,
    [
      entry.entryType, entry.amount, entry.category, entry.paymentMethod || null,
      entry.entryDate, entry.notes || null, entry.receiptName || null,
      entry.receiptType || null, entry.receiptData || null,
      toMysqlDateTime(entry.updatedAt), entryId, enterpriseId,
    ],
  );
  if (!result.affectedRows) throw httpError(404, "Finance entry not found");
  return (await listFinanceEntries(enterpriseId)).find((item) => item.id === entryId);
}

async function deleteFinanceEntry(session, entryId) {
  const [entries] = await pool.query(
    "SELECT entry_type AS entryType, amount, category FROM customer_credit_finance_entries WHERE id = ? AND enterprise_id = ? LIMIT 1",
    [entryId, session.enterpriseId],
  );
  if (!entries.length) throw httpError(404, "Finance entry not found");
  await pool.query(
    "DELETE FROM customer_credit_finance_entries WHERE id = ? AND enterprise_id = ?",
    [entryId, session.enterpriseId],
  );
  await recordAudit(pool, session, {
    action: `finance.${entries[0].entryType}.deleted`,
    entityType: "finance_entry",
    entityId: entryId,
    summary: `Deleted ${entries[0].entryType} ${Number(entries[0].amount).toFixed(2)} in ${entries[0].category}`,
  });
}

async function getFinanceSummary(enterpriseId) {
  const [rows] = await pool.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN entry_date = UTC_DATE() AND entry_type = 'revenue' THEN amount ELSE 0 END), 0) AS todayRevenue,
        COALESCE(SUM(CASE WHEN entry_date = UTC_DATE() AND entry_type = 'expense' THEN amount ELSE 0 END), 0) AS todayExpenses,
        COALESCE(SUM(CASE WHEN entry_date >= DATE_SUB(UTC_DATE(), INTERVAL WEEKDAY(UTC_DATE()) DAY)
          THEN CASE WHEN entry_type = 'revenue' THEN amount ELSE -amount END ELSE 0 END), 0) AS weekProfit,
        COALESCE(SUM(CASE WHEN entry_date >= DATE_FORMAT(UTC_DATE(), '%Y-%m-01')
          THEN CASE WHEN entry_type = 'revenue' THEN amount ELSE -amount END ELSE 0 END), 0) AS monthProfit
      FROM customer_credit_finance_entries
      WHERE enterprise_id = ?
    `,
    [enterpriseId],
  );
  const [categoryRows] = await pool.query(
    `
      SELECT category, SUM(amount) AS amount
      FROM customer_credit_finance_entries
      WHERE enterprise_id = ? AND entry_type = 'expense' AND entry_date = UTC_DATE()
      GROUP BY category ORDER BY amount DESC LIMIT 1
    `,
    [enterpriseId],
  );
  const row = rows[0];
  return {
    todayRevenue: Number(row.todayRevenue || 0),
    todayExpenses: Number(row.todayExpenses || 0),
    todayProfit: Number(row.todayRevenue || 0) - Number(row.todayExpenses || 0),
    weekProfit: Number(row.weekProfit || 0),
    monthProfit: Number(row.monthProfit || 0),
    biggestExpenseCategory: categoryRows[0]?.category || "",
    biggestExpenseAmount: Number(categoryRows[0]?.amount || 0),
  };
}

async function getFinanceReports(enterpriseId) {
  const [daily] = await pool.query(
    `
      SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS label,
        SUM(CASE WHEN entry_type = 'revenue' THEN amount ELSE 0 END) AS revenue,
        SUM(CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END) AS expenses
      FROM customer_credit_finance_entries
      WHERE enterprise_id = ? AND entry_date >= UTC_DATE() - INTERVAL 29 DAY
      GROUP BY entry_date ORDER BY entry_date
    `,
    [enterpriseId],
  );
  const [monthly] = await pool.query(
    `
      SELECT DATE_FORMAT(entry_date, '%Y-%m') AS label,
        SUM(CASE WHEN entry_type = 'revenue' THEN amount ELSE 0 END) AS revenue,
        SUM(CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END) AS expenses
      FROM customer_credit_finance_entries
      WHERE enterprise_id = ? AND entry_date >= DATE_FORMAT(UTC_DATE() - INTERVAL 11 MONTH, '%Y-%m-01')
      GROUP BY DATE_FORMAT(entry_date, '%Y-%m') ORDER BY label
    `,
    [enterpriseId],
  );
  return {
    daily: daily.map(mapReportRow),
    monthly: monthly.map(mapReportRow),
  };
}

function mapFinanceEntry(entry) {
  return {
    ...entry,
    amount: Number(entry.amount || 0),
    paymentMethod: entry.paymentMethod || "",
    notes: entry.notes || "",
    receiptName: entry.receiptName || "",
    receiptType: entry.receiptType || "",
    receiptData: entry.receiptData || "",
    createdAt: toIsoLike(entry.createdAt),
    updatedAt: toIsoLike(entry.updatedAt),
  };
}

function mapReportRow(row) {
  const revenue = Number(row.revenue || 0);
  const expenses = Number(row.expenses || 0);
  return { label: row.label, revenue, expenses, profit: revenue - expenses };
}

async function upsertVendor(session, vendor) {
  const enterpriseId = session.enterpriseId;
  const [existingRows] = await pool.query(
    "SELECT enterprise_id AS enterpriseId FROM customer_credit_vendor_tracking WHERE id = ? LIMIT 1",
    [vendor.id],
  );
  if (existingRows.length && existingRows[0].enterpriseId !== enterpriseId) {
    throw new Error("Vendor belongs to a different enterprise");
  }
  if (vendor.vendorAccountId) {
    const [accounts] = await pool.query(
      "SELECT id FROM customer_credit_vendor_accounts WHERE id = ? AND enterprise_id = ? AND status = 'active' LIMIT 1",
      [vendor.vendorAccountId, enterpriseId],
    );
    if (!accounts.length) throw httpError(400, "Select a vendor that belongs to this store");
  }

  await pool.query(
    `
      INSERT INTO customer_credit_vendor_tracking
        (id, enterprise_id, vendor_account_id, vendor_name, contact_name, quantity, unit, received_quantity, spoiled_quantity, accepted_quantity, returned_quantity, phone, email, reference, amount, due_date, status, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        vendor_name = VALUES(vendor_name),
        vendor_account_id = VALUES(vendor_account_id),
        contact_name = VALUES(contact_name),
        quantity = VALUES(quantity),
        unit = VALUES(unit),
        received_quantity = VALUES(received_quantity),
        spoiled_quantity = VALUES(spoiled_quantity),
        accepted_quantity = VALUES(accepted_quantity),
        returned_quantity = VALUES(returned_quantity),
        phone = VALUES(phone),
        email = VALUES(email),
        reference = VALUES(reference),
        amount = VALUES(amount),
        due_date = VALUES(due_date),
        status = VALUES(status),
        note = VALUES(note),
        updated_at = VALUES(updated_at)
    `,
    [
      vendor.id,
      enterpriseId,
      vendor.vendorAccountId || null,
      vendor.vendorName,
      vendor.contactName || null,
      vendor.quantity,
      vendor.unit,
      vendor.receivedQuantity,
      vendor.spoiledQuantity,
      vendor.acceptedQuantity,
      vendor.returnedQuantity,
      vendor.phone || null,
      vendor.email || null,
      vendor.reference || null,
      vendor.amount,
      vendor.dueDate || null,
      vendor.status,
      vendor.note || null,
      toMysqlDateTime(vendor.createdAt),
      toMysqlDateTime(vendor.updatedAt),
    ],
  );

  if (vendor.spoiledQuantity > 0) {
    await pool.query(
      `INSERT INTO customer_credit_vendor_spoilage_history
        (enterprise_id, receiving_id, vendor_name, product, received_quantity, spoilage_quantity,
         accepted_quantity, note, recorded_by, receiving_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [enterpriseId, vendor.id, vendor.vendorName, vendor.reference || null, vendor.receivedQuantity,
       vendor.spoiledQuantity, vendor.acceptedQuantity, vendor.note || null,
       session.username || session.displayName || null, toMysqlDateTime(vendor.createdAt)],
    );
  }

  const [rows] = await pool.query(
    `
      SELECT
        id,
        vendor_account_id AS vendorAccountId,
        vendor_name AS vendorName,
        contact_name AS contactName,
        quantity,
        unit,
        received_quantity AS receivedQuantity,
        spoiled_quantity AS spoiledQuantity,
        accepted_quantity AS acceptedQuantity,
        returned_quantity AS returnedQuantity,
        phone,
        email,
        reference,
        amount,
        DATE_FORMAT(due_date, '%Y-%m-%d') AS dueDate,
        status,
        note,
        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
        DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s') AS updatedAt
      FROM customer_credit_vendor_tracking
      WHERE enterprise_id = ? AND id = ?
      LIMIT 1
    `,
    [enterpriseId, vendor.id],
  );
  const saved = rows[0];
  return {
    id: saved.id,
    vendorAccountId: saved.vendorAccountId || "",
    vendorName: saved.vendorName,
    contactName: saved.contactName || "",
    quantity: validVendorQuantity(saved.quantity),
    unit: saved.unit || "piece",
    receivedQuantity: validVendorCount(saved.receivedQuantity),
    spoiledQuantity: validVendorCount(saved.spoiledQuantity),
    acceptedQuantity: validVendorCount(saved.acceptedQuantity),
    returnedQuantity: validVendorCount(saved.returnedQuantity),
    phone: saved.phone || "",
    email: saved.email || "",
    reference: saved.reference || "",
    amount: Number(saved.amount || 0),
    price: Number(saved.amount || 0),
    dueDate: saved.dueDate || "",
    status: validVendorStatus(saved.status),
    note: saved.note || "",
    createdAt: toIsoLike(saved.createdAt),
    updatedAt: toIsoLike(saved.updatedAt),
  };
}

async function deleteVendor(session, vendorId) {
  const [vendors] = await pool.query(
    "SELECT vendor_name AS vendorName FROM customer_credit_vendor_tracking WHERE id = ? AND enterprise_id = ? LIMIT 1",
    [vendorId, session.enterpriseId],
  );
  const [result] = await pool.query(
    "DELETE FROM customer_credit_vendor_tracking WHERE id = ? AND enterprise_id = ?",
    [vendorId, session.enterpriseId],
  );
  if (result.affectedRows) {
    await recordAudit(pool, session, {
      action: "vendor.deleted",
      entityType: "vendor",
      entityId: vendorId,
      summary: `Deleted vendor ${vendors[0]?.vendorName || vendorId}`,
    });
  }
}

async function markVendorsPaid(session, vendorIds) {
  const ids = [...new Set(
    (Array.isArray(vendorIds) ? vendorIds : [])
      .map((id) => String(id || "").trim())
      .filter((id) => id.length > 0 && id.length <= 128),
  )].slice(0, 1000);
  if (!ids.length) {
    throw new Error("Choose at least one vendor delivery to mark paid");
  }

  const selectPlaceholders = ids.map(() => "?").join(", ");
  const [vendors] = await pool.query(
    `
      SELECT id, vendor_name AS vendorName
      FROM customer_credit_vendor_tracking
      WHERE enterprise_id = ? AND id IN (${selectPlaceholders})
    `,
    [session.enterpriseId, ...ids],
  );
  if (!vendors.length) {
    return { updated: 0 };
  }

  const ownedIds = vendors.map((vendor) => vendor.id);
  const updatePlaceholders = ownedIds.map(() => "?").join(", ");
  const [result] = await pool.query(
    `
      UPDATE customer_credit_vendor_tracking
      SET status = 'paid', updated_at = ?
      WHERE enterprise_id = ? AND id IN (${updatePlaceholders}) AND status <> 'paid'
    `,
    [toMysqlDateTime(new Date().toISOString()), session.enterpriseId, ...ownedIds],
  );

  if (result.affectedRows) {
    const vendorNames = [...new Set(vendors.map((vendor) => vendor.vendorName).filter(Boolean))];
    await recordAudit(pool, session, {
      action: "vendor.marked_paid",
      entityType: "vendor",
      entityId: vendorNames[0] || ownedIds[0],
      summary: `Marked ${result.affectedRows} vendor deliver${result.affectedRows === 1 ? "y" : "ies"} paid${vendorNames.length ? ` for ${vendorNames.slice(0, 3).join(", ")}` : ""}`,
    });
  }

  return { updated: result.affectedRows };
}

async function setVendorsUnpaid(session, vendorIds) {
  const ids = [...new Set((Array.isArray(vendorIds) ? vendorIds : [])
    .map((id) => String(id || "").trim()).filter((id) => id.length > 0 && id.length <= 128))].slice(0, 1000);
  if (!ids.length) throw new Error("Choose at least one vendor delivery to mark unpaid");
  const placeholders = ids.map(() => "?").join(", ");
  const [result] = await pool.query(`UPDATE customer_credit_vendor_tracking
    SET status = 'due', updated_at = ?
    WHERE enterprise_id = ? AND id IN (${placeholders}) AND status = 'paid'`,
  [toMysqlDateTime(new Date().toISOString()), session.enterpriseId, ...ids]);
  if (result.affectedRows) await recordAudit(pool, session, { action: "vendor.marked_unpaid",
    entityType: "vendor", entityId: ids[0], summary: `Marked ${result.affectedRows} vendor deliveries unpaid` });
  return { updated: result.affectedRows };
}

async function listRecords(enterpriseId) {
  const [records] = await pool.query(`
    SELECT
      id,
      customer_name AS customerName,
      customer_phone AS customerPhone,
      item_note AS itemNote,
      DATE_FORMAT(credit_date, '%Y-%m-%d') AS creditDate,
      TIME_FORMAT(credit_time, '%H:%i') AS creditTime,
      credit_amount AS creditAmount,
      DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt,
      DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s') AS updatedAt
    FROM customer_credit_records
    WHERE enterprise_id = ?
    ORDER BY updated_at DESC, created_at DESC
  `, [enterpriseId]);

  const [payments] = await pool.query(`
    SELECT
      id,
      record_id AS recordId,
      DATE_FORMAT(payment_date, '%Y-%m-%d') AS date,
      TIME_FORMAT(payment_time, '%H:%i') AS time,
      amount,
      note
    FROM customer_credit_payments
    WHERE record_id IN (
      SELECT id FROM customer_credit_records WHERE enterprise_id = ?
    )
    ORDER BY payment_date ASC, payment_time ASC, created_at ASC
  `, [enterpriseId]);

  const paymentsByRecord = new Map();
  for (const payment of payments) {
    const list = paymentsByRecord.get(payment.recordId) || [];
    list.push({
      id: payment.id,
      date: payment.date,
      time: payment.time || "",
      amount: Number(payment.amount || 0),
      note: payment.note || "",
    });
    paymentsByRecord.set(payment.recordId, list);
  }

  return records.map((record) => ({
    id: record.id,
    customerName: record.customerName,
    customerPhone: record.customerPhone || "",
    itemNote: record.itemNote,
    creditDate: record.creditDate,
    creditTime: record.creditTime || "",
    creditAmount: Number(record.creditAmount || 0),
    payments: paymentsByRecord.get(record.id) || [],
    createdAt: toIsoLike(record.createdAt),
    updatedAt: toIsoLike(record.updatedAt),
  }));
}

async function saveRecords(session, records, audit) {
  const enterpriseId = session.enterpriseId;
  const normalizedRecords = records.map(normalizeRecord);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (!normalizedRecords.length) {
      await connection.query("DELETE FROM customer_credit_records WHERE enterprise_id = ?", [enterpriseId]);
      await recordAudit(connection, session, audit || {
        action: "records.cleared",
        entityType: "credit",
        entityId: null,
        summary: "Cleared all credit records",
      });
      await connection.commit();
      return;
    }

    const recordIds = normalizedRecords.map((record) => record.id);
    await connection.query("DELETE FROM customer_credit_records WHERE enterprise_id = ? AND id NOT IN (?)", [
      enterpriseId,
      recordIds,
    ]);

    for (const record of normalizedRecords) {
      await upsertRecord(connection, enterpriseId, record);
      await connection.query("DELETE FROM customer_credit_payments WHERE record_id = ?", [record.id]);
      for (const payment of record.payments) {
        await insertPaymentForConnection(connection, record.id, payment);
      }
    }

    await recordAudit(connection, session, audit || {
      action: "records.synced",
      entityType: "credit",
      entityId: null,
      summary: "Updated credit records",
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function upsertRecordWithPayments(enterpriseId, record) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await upsertRecord(connection, enterpriseId, record);
    await connection.query("DELETE FROM customer_credit_payments WHERE record_id = ?", [record.id]);
    for (const payment of record.payments) {
      await insertPaymentForConnection(connection, record.id, payment);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function upsertRecord(connection, enterpriseId, record) {
  const [existingRecords] = await connection.query(
    "SELECT enterprise_id AS enterpriseId FROM customer_credit_records WHERE id = ? LIMIT 1",
    [record.id],
  );
  if (existingRecords.length && existingRecords[0].enterpriseId !== enterpriseId) {
    throw new Error("Credit record belongs to a different enterprise");
  }

  await connection.query(
    `
      INSERT INTO customer_credit_records
        (id, enterprise_id, customer_name, customer_phone, item_note, credit_date, credit_time, credit_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        enterprise_id = VALUES(enterprise_id),
        customer_name = VALUES(customer_name),
        customer_phone = VALUES(customer_phone),
        item_note = VALUES(item_note),
        credit_date = VALUES(credit_date),
        credit_time = VALUES(credit_time),
        credit_amount = VALUES(credit_amount),
        updated_at = VALUES(updated_at)
    `,
    [
      record.id,
      enterpriseId,
      record.customerName,
      record.customerPhone || null,
      record.itemNote,
      record.creditDate,
      record.creditTime || null,
      record.creditAmount,
      toMysqlDateTime(record.createdAt),
      toMysqlDateTime(record.updatedAt),
    ],
  );
}

async function insertPayment(enterpriseId, recordId, payment) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [records] = await connection.query(
      "SELECT id FROM customer_credit_records WHERE id = ? AND enterprise_id = ? LIMIT 1",
      [recordId, enterpriseId],
    );
    if (!records.length) {
      throw new Error("Credit record not found for this enterprise");
    }
    await insertPaymentForConnection(connection, recordId, payment);
    await connection.query("UPDATE customer_credit_records SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND enterprise_id = ?", [
      recordId,
      enterpriseId,
    ]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function insertPaymentForConnection(connection, recordId, payment) {
  await connection.query(
    `
      INSERT INTO customer_credit_payments
        (id, record_id, payment_date, payment_time, amount, note)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        payment_date = VALUES(payment_date),
        payment_time = VALUES(payment_time),
        amount = VALUES(amount),
        note = VALUES(note)
    `,
    [payment.id, recordId, payment.date, payment.time || null, payment.amount, payment.note || null],
  );
}

function normalizeRecord(record) {
  const now = new Date().toISOString();
  return {
    id: requiredString(record.id || cryptoRandomId(), "Record id"),
    customerName: requiredString(record.customerName, "Customer name"),
    customerPhone: String(record.customerPhone || "").trim(),
    itemNote: requiredString(record.itemNote, "Item or note"),
    creditDate: validDate(record.creditDate),
    creditTime: validTime(record.creditTime || ""),
    creditAmount: validAmount(record.creditAmount),
    payments: Array.isArray(record.payments) ? record.payments.map(normalizePayment) : [],
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
  };
}

function normalizePayment(payment) {
  return {
    id: requiredString(payment.id || cryptoRandomId(), "Payment id"),
    date: validDate(payment.date),
    time: validTime(payment.time || ""),
    amount: validAmount(payment.amount),
    note: String(payment.note || "").trim(),
  };
}

function normalizeProduct(product) {
  const now = new Date().toISOString();
  return {
    id: requiredString(product.id || cryptoRandomId(), "Product id"),
    name: requiredString(product.name, "Product name").slice(0, 160),
    price: validAmount(product.price),
    barcode: validBarcode(product.barcode),
    quantity: validProductQuantity(product.quantity),
    labelSize: validLabelSize(product.labelSize),
    createdAt: product.createdAt || now,
    updatedAt: now,
  };
}

function normalizeVendorEntry(vendor) {
  const now = new Date().toISOString();
  const hasReceivedQuantity = vendor.receivedQuantity !== undefined || vendor.received !== undefined;
  const hasSpoiledQuantity = vendor.spoiledQuantity !== undefined || vendor.spoiled !== undefined;
  const hasReturnedQuantity = vendor.returnedQuantity !== undefined || vendor.returned !== undefined;
  const requestedReceivedQuantity = hasReceivedQuantity ? strictVendorCount(vendor.receivedQuantity ?? vendor.received, "Received quantity") : 0;
  const requestedSpoiledQuantity = hasSpoiledQuantity ? strictVendorCount(vendor.spoiledQuantity ?? vendor.spoiled, "Spoilage quantity") : 0;
  const requestedReturnedQuantity = hasReturnedQuantity ? validVendorCount(vendor.returnedQuantity ?? vendor.returned) : 0;
  const hasDirectionalQuantity = hasReceivedQuantity || hasSpoiledQuantity || hasReturnedQuantity;
  const derivedQuantity = Math.max(1, requestedReceivedQuantity, requestedSpoiledQuantity, requestedReturnedQuantity);
  const quantity =
    vendor.quantity === undefined || vendor.quantity === null || String(vendor.quantity).trim() === ""
      ? derivedQuantity
      : validVendorQuantity(vendor.quantity);
  const quantities = calculateAccepted(requestedReceivedQuantity, requestedSpoiledQuantity);
  const spoiledQuantity = quantities.spoilage;
  const returnedQuantity = Math.min(quantity, requestedReturnedQuantity);
  const receivedQuantity = hasDirectionalQuantity ? quantities.received : quantity;
  const acceptedQuantity = hasDirectionalQuantity ? quantities.accepted : quantity;
  return {
    id: requiredString(vendor.id || cryptoRandomId(), "Vendor id"),
    vendorAccountId: String(vendor.vendorAccountId || "").trim().slice(0, 64),
    vendorName: requiredString(vendor.vendorName || vendor.name, "Vendor name").slice(0, 160),
    contactName: String(vendor.contactName || "").trim().slice(0, 160),
    quantity,
    unit: String(vendor.unit || "piece").trim().slice(0, 40) || "piece",
    receivedQuantity,
    spoiledQuantity,
    acceptedQuantity,
    returnedQuantity,
    phone: String(vendor.phone || "").trim().slice(0, 60),
    email: validOptionalEmail(vendor.email),
    reference: String(vendor.reference || "").trim().slice(0, 120),
    amount: validAmount(vendor.price ?? vendor.amount),
    dueDate: validOptionalDate(vendor.dueDate),
    status: validVendorStatus(vendor.status),
    note: String(vendor.note || "").trim().slice(0, 255),
    createdAt: vendor.createdAt || now,
    updatedAt: now,
  };
}

function normalizeMeatOrder(order) {
  const pickupAt = new Date(order.pickupAt);
  if (Number.isNaN(pickupAt.getTime())) throw new Error("Valid pickup date and time are required");
  const sourceItems = Array.isArray(order.items) && order.items.length ? order.items : [{
    productName: order.meatType, quantity: parseFloat(order.quantity) || 1,
    unit: String(order.quantity || "").replace(String(parseFloat(order.quantity) || ""), "").trim() || "item",
    specialInstructions: order.preparationInstructions, price: null,
  }];
  if (sourceItems.length > 50) throw new Error("An order can contain at most 50 products");
  const items = sourceItems.map((item) => {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Each product needs a quantity greater than zero");
    const price = item.price === "" || item.price == null ? null : Number(item.price);
    if (price != null && (!Number.isFinite(price) || price < 0)) throw new Error("Product price cannot be negative");
    return { id: requiredString(item.id || cryptoRandomId(), "Item id").slice(0, 64),
      productName: requiredString(item.productName || item.name, "Product name").slice(0, 160),
      quantity, unit: requiredString(item.unit, "Unit").slice(0, 40),
      specialInstructions: String(item.specialInstructions || "").trim().slice(0, 500), price };
  });
  return {
    id: requiredString(order.id || cryptoRandomId(), "Order id").slice(0, 64),
    customerName: requiredString(order.customerName, "Customer name").slice(0, 160),
    customerPhone: requiredString(order.customerPhone, "Phone number").slice(0, 60),
    meatType: items[0].productName,
    quantity: `${items[0].quantity} ${items[0].unit}`,
    items,
    preparationInstructions: String(order.preparationInstructions || "").trim().slice(0, 500),
    pickupAt: pickupAt.toISOString(),
    employeeName: requiredString(order.employeeName, "Employee name").slice(0, 160),
    createdAt: new Date().toISOString(),
  };
}

function normalizeFinanceEntry(entry) {
  const now = new Date().toISOString();
  const entryType = String(entry.entryType || "").trim().toLowerCase();
  if (!["revenue", "expense"].includes(entryType)) throw new Error("Entry type must be revenue or expense");
  const allowedCategories = entryType === "revenue"
    ? ["sales", "grocery", "meat", "restaurant", "other"]
    : ["salary", "product purchase", "bread", "cookies and sweet", "injera", "rent", "utilities", "transportation", "maintenance", "tax", "other"];
  const category = String(entry.category || "").trim().toLowerCase();
  if (!allowedCategories.includes(category)) throw new Error("Choose a valid category");
  const receiptData = String(entry.receiptData || "");
  const receiptType = String(entry.receiptType || "").trim().toLowerCase();
  if (receiptData) {
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(receiptType)) {
      throw new Error("Receipt must be a JPG, PNG, WebP, or PDF");
    }
    if (Buffer.byteLength(receiptData, "utf8") > 2_500_000) throw new Error("Receipt must be smaller than 1.8 MB");
  }
  return {
    id: requiredString(entry.id || cryptoRandomId(), "Entry id").slice(0, 64),
    entryType,
    amount: validPositiveAmount(entry.amount),
    category,
    paymentMethod: entryType === "revenue"
      ? requiredString(entry.paymentMethod, "Payment method").slice(0, 60)
      : String(entry.paymentMethod || "").trim().slice(0, 60),
    entryDate: validDate(entry.entryDate),
    notes: String(entry.notes || "").trim().slice(0, 500),
    receiptName: String(entry.receiptName || "").trim().slice(0, 180),
    receiptType: receiptData ? receiptType : "",
    receiptData,
    createdAt: entry.createdAt || now,
    updatedAt: now,
  };
}

function requiredString(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text.slice(0, 255);
}

function validDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Valid date is required");
  return text;
}

function validOptionalDate(value) {
  const text = String(value || "").trim();
  return text ? validDate(text) : null;
}

function validTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^\d{2}:\d{2}$/.test(text)) throw new Error("Valid time is required");
  return text;
}

function validAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Valid amount is required");
  return amount;
}

function validPositiveAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99) {
    throw new Error("Amount must be greater than zero");
  }
  return Math.round(amount * 100) / 100;
}

function validBarcode(value) {
  const barcode = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z ./$+%-]/g, "");
  if (!barcode) throw new Error("Barcode is required");
  return barcode.slice(0, 80);
}

function validProductQuantity(value) {
  const quantity = Number.parseInt(value, 10);
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_PRODUCT_QUANTITY, Math.max(1, quantity));
}

function validVendorQuantity(value) {
  const quantity = Number.parseInt(value, 10);
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_VENDOR_QUANTITY, Math.max(1, quantity));
}

function validVendorCount(value) {
  const quantity = Number.parseInt(value, 10);
  if (!Number.isFinite(quantity)) return 0;
  return Math.min(MAX_VENDOR_QUANTITY, Math.max(0, quantity));
}

function strictVendorCount(value, label) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > MAX_VENDOR_QUANTITY) {
    throw new Error(`${label} must be between 0 and ${MAX_VENDOR_QUANTITY}`);
  }
  return quantity;
}

function validVendorStatus(value) {
  const status = String(value || "ordered").trim().toLowerCase();
  return ["ordered", "received", "due", "paid"].includes(status) ? status : "ordered";
}

function validOptionalEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return "";
  if (!isValidEmail(email)) throw new Error("Enter a valid vendor email address");
  return email;
}

function validLabelSize(value) {
  const size = String(value || "medium").trim().toLowerCase();
  return ["small", "medium", "large"].includes(size) ? size : "medium";
}

async function getAiDashboardMetrics(enterpriseId) {
  const [financeRows, vendorRows, orderRows, creditRows, productRows, dailyRows, weeklyRows, printRows] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(CASE WHEN entry_type='revenue' THEN amount ELSE 0 END),0) income,
      COALESCE(SUM(CASE WHEN entry_type='expense' THEN amount ELSE 0 END),0) expenses
      FROM customer_credit_finance_entries WHERE enterprise_id=? AND entry_date=CURDATE()`, [enterpriseId]),
    pool.query(`SELECT
      SUM(DATE(created_at)=CURDATE() AND status IN ('received','due','paid')) deliveriesToday,
      COALESCE(SUM(CASE WHEN status <> 'paid' THEN accepted_quantity * amount ELSE 0 END),0) unpaidBalance
      FROM customer_credit_vendor_tracking WHERE enterprise_id=?`, [enterpriseId]),
    pool.query(`SELECT
      SUM(status <> 'picked_up') activeOrders,
      SUM(status <> 'picked_up' AND pickup_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 20 MINUTE)) dueSoon,
      SUM(status <> 'picked_up' AND pickup_at < NOW()) overdueOrders
      FROM customer_credit_meat_orders WHERE enterprise_id=?`, [enterpriseId]),
    pool.query(`SELECT COALESCE(SUM(balance_due),0) creditBalance,
      customer_name customerName, customer_phone customerPhone, SUM(balance_due) balance
      FROM customer_credit_balances WHERE enterprise_id=? GROUP BY customer_name, customer_phone
      ORDER BY balance DESC LIMIT 20`, [enterpriseId]),
    pool.query(`SELECT name, quantity, price, barcode, DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s') createdAt
      FROM customer_credit_products WHERE enterprise_id=? ORDER BY created_at DESC LIMIT 30`, [enterpriseId]),
    pool.query(`SELECT DATE_FORMAT(entry_date,'%Y-%m-%d') label,
      COALESCE(SUM(CASE WHEN entry_type='revenue' THEN amount ELSE 0 END),0) value
      FROM customer_credit_finance_entries WHERE enterprise_id=? AND entry_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY entry_date ORDER BY entry_date`, [enterpriseId]),
    pool.query(`SELECT DATE_FORMAT(entry_date,'%x-W%v') label,
      COALESCE(SUM(CASE WHEN entry_type='revenue' THEN amount ELSE 0 END),0) value
      FROM customer_credit_finance_entries WHERE enterprise_id=? AND entry_date >= DATE_SUB(CURDATE(), INTERVAL 7 WEEK)
      GROUP BY YEARWEEK(entry_date,3) ORDER BY YEARWEEK(entry_date,3)`, [enterpriseId]),
    pool.query(`SELECT COALESCE(SUM(label_count),0) count FROM customer_credit_barcode_print_events
      WHERE enterprise_id=? AND DATE(printed_at)=CURDATE()`, [enterpriseId]),
  ]);
  const finance = financeRows[0][0] || {};
  const vendors = vendorRows[0][0] || {};
  const orders = orderRows[0][0] || {};
  const creditCustomers = creditRows[0] || [];
  const products = productRows[0] || [];
  const cards = {
    todayIncome: Number(finance.income || 0),
    todayVendorDeliveries: Number(vendors.deliveriesToday || 0),
    activeOrders: Number(orders.activeOrders || 0),
    ordersDueSoon: Number(orders.dueSoon || 0),
    overdueOrders: Number(orders.overdueOrders || 0),
    unpaidVendorBalance: Number(vendors.unpaidBalance || 0),
    customerCreditBalance: creditCustomers.reduce((sum, row) => sum + Number(row.balance || 0), 0),
    lowStockProducts: products.filter((item) => Number(item.quantity) <= 5).length,
    recentlyAddedProducts: products.filter((item) => Date.now() - new Date(`${item.createdAt}Z`).getTime() <= 7 * 86400000).length,
    barcodeLabelsPrintedToday: Number(printRows[0][0]?.count || 0),
  };
  const compactProducts = products.slice(0, 15).map((item) => ({
    name: item.name, quantity: Number(item.quantity), price: Number(item.price), barcode: item.barcode,
  }));
  return {
    generatedAt: new Date().toISOString(),
    cards,
    dailySales: dailyRows[0].map((row) => ({ label: row.label, value: Number(row.value) })),
    weeklySales: weeklyRows[0].map((row) => ({ label: row.label, value: Number(row.value) })),
    lowStock: compactProducts.filter((item) => item.quantity <= 5),
    recentProducts: compactProducts.slice(0, 8),
    aiContext: {
      asOf: new Date().toISOString(), metrics: cards,
      lowStockProducts: compactProducts.filter((item) => item.quantity <= 5),
      recentProducts: compactProducts.slice(0, 8),
      highestCustomerBalances: creditCustomers.slice(0, 10).map((row) => ({
        customer: row.customerName, phone: row.customerPhone || "", balance: Number(row.balance),
      })),
      dailySales: dailyRows[0], weeklySales: weeklyRows[0],
    },
  };
}

async function getAiReferenceData(enterpriseId, context) {
  if (context === "vendor") {
    return { vendors: (await listVendors(enterpriseId)).slice(0, 100).map((v) => ({ id: v.id, name: v.vendorName })) };
  }
  if (context === "barcode") {
    return { products: (await listProducts(enterpriseId)).slice(0, 200).map((p) => ({ id: p.id, name: p.name, barcode: p.barcode, price: p.price })) };
  }
  const [customers] = await pool.query(`SELECT customer_name name, customer_phone phone, MAX(updated_at) updatedAt
    FROM customer_credit_records WHERE enterprise_id=? GROUP BY customer_name, customer_phone
    ORDER BY updatedAt DESC LIMIT 100`, [enterpriseId]);
  return { currentDateTime: new Date().toISOString(), customers };
}

function aiDraftSchema(context) {
  const fields = context === "vendor"
    ? { vendorName: "string", vendorId: "string", product: "string", quantity: "number", unit: "string", date: "string", time: "string", employee: "string", notes: "string" }
    : context === "barcode"
      ? { productName: "string", productId: "string", quantity: "number", price: "number", barcode: "string", existingProduct: "boolean" }
      : { customerName: "string", customerPhone: "string", product: "string", quantity: "string", pickupDate: "string", pickupTime: "string", notes: "string" };
  return {
    type: "object",
    properties: Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, { type }])),
    required: Object.keys(fields),
    additionalProperties: false,
  };
}

async function askOpenAI({ instructions, input, schema }) {
  if (!config.openai.apiKey) throw httpError(503, "AI is not configured. Add OPENAI_API_KEY to Railway variables.");
  const payload = { model: config.openai.model, instructions, input };
  if (schema) payload.text = { format: { type: "json_schema", name: "store_draft", strict: true, schema } };
  const result = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openai.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw httpError(502, data.error?.message || "OpenAI request failed");
  return data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text || "";
}

async function askOpenAIJson(options) {
  const text = await askOpenAI({ ...options, schema: options.schema });
  try { return JSON.parse(text); } catch { throw httpError(502, "AI returned an invalid draft"); }
}

async function transcribeAudio(audioBase64, mimeType) {
  if (!config.openai.apiKey) throw httpError(503, "AI is not configured. Add OPENAI_API_KEY to Railway variables.");
  const raw = String(audioBase64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw httpError(400, "Audio is required");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length > 8 * 1024 * 1024) throw httpError(413, "Audio must be smaller than 8 MB");
  const form = new FormData();
  form.append("model", config.openai.transcriptionModel);
  form.append("file", new Blob([bytes], { type: String(mimeType || "audio/webm") }), "voice.webm");
  const result = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${config.openai.apiKey}` }, body: form,
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw httpError(502, data.error?.message || "Voice transcription failed");
  return String(data.text || "").trim();
}

async function readJsonBody(request, maxBytes = 3 * 1024 * 1024) {
  const body = await readRawBody(request, maxBytes);
  if (!body) return {};
  return JSON.parse(body);
}

async function readRawBody(request, maxBytes = 3 * 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large");
    chunks.push(chunk);
  }

  if (!chunks.length) return "";
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function setCommonHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", config.publicOrigin || `http://127.0.0.1:${config.port}`);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
}

function isAuthenticated(request) {
  return Boolean(getSession(request));
}

function getSession(request) {
  const cookie = parseCookies(request.headers.cookie || "").store_session;
  if (!cookie) return null;

  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Date.now() >= session.exp) return null;
    if (!session.enterpriseId || !session.userId) return null;
    return session;
  } catch {
    return null;
  }
}

function setSession(response, user) {
  const maxAgeSeconds = Math.max(1, config.auth.sessionHours) * 60 * 60;
  const payload = Buffer.from(
    JSON.stringify({
      enterpriseId: user.enterpriseId,
      enterpriseCode: user.enterpriseCode,
      enterpriseName: user.enterpriseName,
      userId: user.userId,
      username: user.username,
      role: user.role,
      mustChangePassword: Boolean(user.mustChangePassword),
      sessionVersion: Number(user.sessionVersion || 1),
      email: user.email || "",
      emailVerifiedAt: user.emailVerifiedAt || null,
      exp: Date.now() + maxAgeSeconds * 1000,
    }),
  ).toString("base64url");
  const session = `${payload}.${sign(payload)}`;
  const secureFlag = config.auth.secureCookie ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `store_session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secureFlag}`,
  );
}

function clearSession(response) {
  response.setHeader("Set-Cookie", "store_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function getVendorSession(request) {
  const cookie = parseCookies(request.headers.cookie || "").vendor_session;
  if (!cookie) return null;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.kind !== "vendor" || Date.now() >= session.exp) return null;
    if (!session.enterpriseId || !session.vendorAccountId) return null;
    return session;
  } catch {
    return null;
  }
}

function setVendorSession(response, account) {
  const maxAgeSeconds = Math.max(1, config.auth.sessionHours) * 60 * 60;
  const payload = Buffer.from(JSON.stringify({
    kind: "vendor",
    enterpriseId: account.enterpriseId,
    enterpriseCode: account.enterpriseCode,
    enterpriseName: account.enterpriseName,
    vendorAccountId: account.vendorAccountId,
    vendorName: account.vendorName,
    sessionVersion: Number(account.sessionVersion || 1),
    exp: Date.now() + maxAgeSeconds * 1000,
  })).toString("base64url");
  const secureFlag = config.auth.secureCookie ? "; Secure" : "";
  response.setHeader("Set-Cookie",
    `vendor_session=${payload}.${sign(payload)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secureFlag}`);
}

function clearVendorSession(response) {
  response.setHeader("Set-Cookie", "vendor_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

async function findVendorAccountForLogin(enterpriseCode, login) {
  const email = normalizeVendorEmail(login);
  const phone = normalizeVendorPhone(login);
  const [rows] = await pool.query(`
    SELECT e.id AS enterpriseId, e.code AS enterpriseCode, e.name AS enterpriseName,
      e.status AS enterpriseStatus, a.id AS vendorAccountId, a.vendor_name AS vendorName,
      a.password_hash AS passwordHash, a.session_version AS sessionVersion, a.status
    FROM customer_credit_enterprises e
    INNER JOIN customer_credit_vendor_accounts a ON a.enterprise_id = e.id
    WHERE e.code = ? AND (a.email_normalized = ? OR a.phone_normalized = ?)
    LIMIT 1
  `, [enterpriseCode, email || null, phone || null]);
  return rows[0] || null;
}

async function refreshVendorSessionAccess(session) {
  const [rows] = await pool.query(`
    SELECT e.id AS enterpriseId, e.code AS enterpriseCode, e.name AS enterpriseName,
      e.status AS enterpriseStatus, a.id AS vendorAccountId, a.vendor_name AS vendorName,
      a.session_version AS sessionVersion, a.status
    FROM customer_credit_enterprises e
    INNER JOIN customer_credit_vendor_accounts a ON a.enterprise_id = e.id
    WHERE e.id = ? AND a.id = ? LIMIT 1
  `, [session.enterpriseId, session.vendorAccountId]);
  const current = rows[0];
  if (!current || current.enterpriseStatus !== "active" || current.status !== "active") return null;
  if (Number(session.sessionVersion || 1) !== Number(current.sessionVersion || 1)) return null;
  return { ...session, ...current };
}

async function findEnterpriseUser(enterpriseCode, username) {
  const [rows] = await pool.query(
    `
      SELECT
        e.id AS enterpriseId,
        e.code AS enterpriseCode,
        e.name AS enterpriseName,
        e.status AS enterpriseStatus,
        u.id AS userId,
        u.username,
        u.role,
        u.must_change_password AS mustChangePassword,
        u.session_version AS sessionVersion,
        u.email,
        u.email_verified_at AS emailVerifiedAt,
        u.password_hash AS passwordHash
      FROM customer_credit_enterprises e
      INNER JOIN customer_credit_users u ON u.enterprise_id = e.id
      WHERE e.code = ? AND u.username = ?
      LIMIT 1
    `,
    [enterpriseCode, username],
  );

  return rows[0] || null;
}

async function refreshSessionAccess(session) {
  const [rows] = await pool.query(
    `
      SELECT
        e.id AS enterpriseId,
        e.code AS enterpriseCode,
        e.name AS enterpriseName,
        e.status AS enterpriseStatus,
        u.id AS userId,
        u.username,
        u.role,
        u.must_change_password AS mustChangePassword,
        u.session_version AS sessionVersion,
        u.email,
        u.email_verified_at AS emailVerifiedAt
      FROM customer_credit_enterprises e
      INNER JOIN customer_credit_users u ON u.enterprise_id = e.id
      WHERE e.id = ? AND u.id = ?
      LIMIT 1
    `,
    [session.enterpriseId, session.userId],
  );
  const current = rows[0];
  if (!current || current.enterpriseStatus !== "active") return null;
  if (
    session.sessionVersion !== undefined &&
    Number(session.sessionVersion) !== Number(current.sessionVersion)
  ) {
    return null;
  }
  return {
    ...session,
    ...current,
    mustChangePassword: Boolean(current.mustChangePassword),
    sessionVersion: Number(current.sessionVersion || 1),
  };
}

async function passwordMatches(password, passwordHash) {
  return verifyPasswordHash(String(password || ""), passwordHash);
}

async function hashPassword(password) {
  const iterations = 210000;
  const salt = crypto.randomBytes(16).toString("base64url");
  const derivedKey = await pbkdf2(String(password || ""), salt, iterations, 32, "sha256");
  return `pbkdf2_sha256$${iterations}$${salt}$${derivedKey.toString("base64url")}`;
}

function sign(value) {
  return crypto.createHmac("sha256", config.auth.sessionSecret).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
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

function normalizeInviteCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "")
    .slice(0, 22);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")) && value.length <= 254;
}

function hashInviteCode(code) {
  return crypto.createHash("sha256").update(normalizeInviteCode(code)).digest("hex");
}

async function verifyPasswordHash(password, storedHash) {
  const [scheme, iterationsText, salt, expected] = String(storedHash).split("$");
  const iterations = Number(iterationsText);
  if (scheme !== "pbkdf2_sha256" || !Number.isInteger(iterations) || !salt || !expected) {
    throw new Error("Invalid STORE_PASSWORD_HASH format");
  }

  const actual = await pbkdf2(password, salt, iterations, 32, "sha256");
  return safeEqual(actual.toString("base64url"), expected);
}

function pbkdf2(password, salt, iterations, keyLength, digest) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, keyLength, digest, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function getClientKey(request) {
  const forwardedFor = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || request.socket.remoteAddress || "unknown";
}

function getLoginRateLimit(clientKey) {
  const attempt = loginAttempts.get(clientKey);
  if (!attempt || !attempt.lockedUntil || Date.now() >= attempt.lockedUntil) {
    if (attempt && attempt.lockedUntil) loginAttempts.delete(clientKey);
    return { locked: false, minutesLeft: 0 };
  }

  return {
    locked: true,
    minutesLeft: Math.max(1, Math.ceil((attempt.lockedUntil - Date.now()) / 60000)),
  };
}

function recordFailedLogin(clientKey) {
  const attempt = loginAttempts.get(clientKey) || { count: 0, lockedUntil: 0 };
  attempt.count += 1;
  if (attempt.count >= config.auth.maxLoginAttempts) {
    attempt.lockedUntil = Date.now() + config.auth.lockMinutes * 60 * 1000;
    attempt.count = 0;
  }
  loginAttempts.set(clientKey, attempt);
}

function clearLoginAttempts(clientKey) {
  loginAttempts.delete(clientKey);
}

function canAttemptSignup(clientKey) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const recentAttempts = (signupAttempts.get(clientKey) || []).filter(
    (timestamp) => timestamp >= cutoff,
  );
  if (recentAttempts.length) signupAttempts.set(clientKey, recentAttempts);
  else signupAttempts.delete(clientKey);
  return recentAttempts.length < config.auth.maxSignupsPerHour;
}

function recordSignupAttempt(clientKey) {
  const attempts = signupAttempts.get(clientKey) || [];
  attempts.push(Date.now());
  signupAttempts.set(clientKey, attempts);
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function sendLoginPage(response, error = "", values = {}, success = "") {
  const enterpriseCode = values.enterpriseCode || "";
  const username = values.username || "";
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Store Login</title>
    <style>${authPageStyles()}</style>
  </head>
  <body>
    <form method="post" action="/login">
      <div>
        <p class="eyebrow">Secure Store Access</p>
        <h1>Customer Credit</h1>
      </div>
      <p class="helper">Enter the enterprise code, username, and password to use customer credit records.</p>
      <p class="success" style="display:${success ? "block" : "none"}">${escapeHtmlServer(success)}</p>
      <p class="error" style="display:${error ? "block" : "none"}">${escapeHtmlServer(error)}</p>
      <label>
        Enterprise code
        <input name="enterprise" value="${escapeHtmlServer(enterpriseCode)}" autocomplete="organization" required />
      </label>
      <label>
        Username
        <input name="username" value="${escapeHtmlServer(username)}" autocomplete="username" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autocomplete="current-password" required autofocus />
      </label>
      <button type="submit">Log In</button>
      <p class="auth-switch"><a href="${config.email.apiKey ? "/forgot-password" : "/access-help"}">Forgot username or password?</a></p>
      <p class="auth-switch">New business? <a href="/signup">Create an account</a></p>
    </form>
  </body>
</html>`);
}

function sendVendorLoginPage(response, error = "", values = {}) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vendor Portal Login</title>
    <style>${authPageStyles()}</style>
  </head>
  <body>
    <form method="post" action="/vendor-login">
      <div><p class="eyebrow">Vendor Portal</p><h1>Vendor Login</h1></div>
      <p class="helper">Use the store code and the phone number or email registered by the store.</p>
      <p class="error" style="display:${error ? "block" : "none"}">${escapeHtmlServer(error)}</p>
      <label>Store code
        <input name="enterprise" value="${escapeHtmlServer(values.enterpriseCode || "")}" autocomplete="organization" required />
      </label>
      <label>Phone or email
        <input name="login" value="${escapeHtmlServer(values.login || "")}" autocomplete="username" required />
      </label>
      <label>Password
        <input name="password" type="password" autocomplete="current-password" required autofocus />
      </label>
      <button type="submit">Log In</button>
      <p class="auth-switch">Store employee? <a href="/login">Staff login</a></p>
    </form>
  </body>
</html>`);
}

function sendSignupPage(response, error = "", values = {}) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Create Store Account</title>
    <style>${authPageStyles()}</style>
  </head>
  <body>
    <form method="post" action="/signup">
      <div>
        <p class="eyebrow">New Enterprise</p>
        <h1>Create Account</h1>
      </div>
      <p class="helper">Create a private customer-credit ledger for your business.</p>
      <p class="error" style="display:${error ? "block" : "none"}">${escapeHtmlServer(error)}</p>
      <label>
        Invitation code
        <input
          name="inviteCode"
          value="${escapeHtmlServer(values.inviteCode || "")}"
          autocomplete="off"
          placeholder="NC-XXXXXXXX-XXXXXXXX"
          maxlength="20"
          required
        />
        <small>Ask the platform owner for a one-time invitation code.</small>
      </label>
      <label>
        Business name
        <input
          name="storeName"
          value="${escapeHtmlServer(values.storeName || "")}"
          autocomplete="organization"
          maxlength="160"
          required
          autofocus
        />
      </label>
      <label>
        Enterprise code
        <input
          name="enterprise"
          value="${escapeHtmlServer(values.enterpriseCode || "")}"
          autocomplete="off"
          minlength="3"
          maxlength="80"
          required
        />
        <small>Use a short code your staff will remember, such as central-market.</small>
      </label>
      <label>
        Owner username
        <input
          name="username"
          value="${escapeHtmlServer(values.username || "")}"
          autocomplete="username"
          minlength="3"
          maxlength="80"
          required
        />
      </label>
      ${
        config.email.apiKey
          ? `
            <label>
              Recovery email
              <input
                name="email"
                type="email"
                value="${escapeHtmlServer(values.email || "")}"
                autocomplete="email"
                maxlength="254"
                required
              />
              <small>A verification link will be sent to this address.</small>
            </label>
          `
          : ""
      }
      <label>
        Password
        <input
          name="password"
          type="password"
          autocomplete="new-password"
          minlength="8"
          maxlength="128"
          required
        />
        <small>At least 8 characters with a letter and a number.</small>
      </label>
      <label>
        Confirm password
        <input
          name="confirmPassword"
          type="password"
          autocomplete="new-password"
          minlength="8"
          maxlength="128"
          required
        />
      </label>
      <button type="submit">Create Account</button>
      <p class="auth-switch">Already registered? <a href="/login">Log in</a></p>
    </form>
  </body>
</html>`);
}

function sendAccessHelpPage(response) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Recover Store Access</title>
    <style>${authPageStyles()}</style>
  </head>
  <body>
    <main class="auth-info">
      <div>
        <p class="eyebrow">Account Recovery</p>
        <h1>Recover Store Access</h1>
      </div>
      <p class="helper">Contact the platform owner and provide your business name or enterprise code. They can confirm your username and issue a temporary password.</p>
      <p class="helper">After signing in with the temporary password, the app will ask you to choose a new one.</p>
      <a class="auth-button" href="/login">Return to Login</a>
    </main>
  </body>
</html>`);
}

function sendForgotPasswordPage(response, error = "", success = "") {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Forgot Login Details</title>
    <style>${authPageStyles()}</style>
  </head>
  <body>
    <form method="post" action="/forgot-password">
      <div>
        <p class="eyebrow">Account Recovery</p>
        <h1>Forgot Login Details</h1>
      </div>
      <p class="helper">Enter the enterprise code and verified recovery email.</p>
      <p class="success" style="display:${success ? "block" : "none"}">${escapeHtmlServer(success)}</p>
      <p class="error" style="display:${error ? "block" : "none"}">${escapeHtmlServer(error)}</p>
      <label>
        Enterprise code
        <input name="enterprise" autocomplete="organization" required />
      </label>
      <label>
        Recovery email
        <input name="email" type="email" autocomplete="email" required />
      </label>
      <button type="submit">Send Recovery Link</button>
      <p class="auth-switch"><a href="/login">Return to login</a></p>
      <p class="auth-switch"><a href="/access-help">Contact the platform owner instead</a></p>
    </form>
  </body>
</html>`);
}

function sendResetPasswordPage(response, token, error = "", success = "") {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>Reset Password</title>
    <style>${authPageStyles()}</style>
  </head>
  <body>
    ${
      success
        ? `
          <main class="auth-info">
            <div>
              <p class="eyebrow">Account Recovery</p>
              <h1>Password Updated</h1>
            </div>
            <p class="success" style="display:block">${escapeHtmlServer(success)}</p>
            <a class="auth-button" href="/login">Return to Login</a>
          </main>
        `
        : `
          <form method="post" action="/reset-password">
            <div>
              <p class="eyebrow">Account Recovery</p>
              <h1>Create New Password</h1>
            </div>
            <p class="error" style="display:${error ? "block" : "none"}">${escapeHtmlServer(error)}</p>
            <input name="token" type="hidden" value="${escapeHtmlServer(token)}" />
            <label>
              New password
              <input name="password" type="password" autocomplete="new-password" minlength="8" required />
            </label>
            <label>
              Confirm new password
              <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
            </label>
            <button type="submit">Update Password</button>
          </form>
        `
    }
  </body>
</html>`);
}

function sendEmailVerificationPage(response, verified) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Email Verification</title>
    <style>${authPageStyles()}</style>
  </head>
  <body>
    <main class="auth-info">
      <div>
        <p class="eyebrow">Recovery Email</p>
        <h1>${verified ? "Email Verified" : "Link Unavailable"}</h1>
      </div>
      <p class="${verified ? "success" : "error"}" style="display:block">
        ${
          verified
            ? "Your recovery email is verified. You can now use automatic password recovery."
            : "This verification link is invalid, expired, or has already been used."
        }
      </p>
      <a class="auth-button" href="/login">Return to Login</a>
    </main>
  </body>
</html>`);
}

function authPageStyles() {
  return `
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      align-items: center;
      background: #edf2f7;
      color: #1f2933;
      display: flex;
      justify-content: center;
      margin: 0;
      min-height: 100vh;
      padding: 24px;
    }

    form, .auth-info {
      background: #ffffff;
      border: 1px solid #d9e2ec;
      border-radius: 8px;
      display: grid;
      gap: 14px;
      max-width: 440px;
      padding: 22px;
      width: 100%;
    }

    .auth-info { gap: 16px; }

    .eyebrow {
      color: #0f766e;
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0;
      margin: 0 0 4px;
      text-transform: uppercase;
    }

    h1, p { margin: 0; }
    h1 { font-size: 1.8rem; line-height: 1.1; }

    label {
      color: #52606d;
      display: grid;
      font-size: 0.85rem;
      font-weight: 700;
      gap: 6px;
    }

    input {
      border: 1px solid #c8d3df;
      border-radius: 6px;
      font: inherit;
      min-height: 44px;
      padding: 10px 11px;
      width: 100%;
    }

    input:focus {
      border-color: #0f766e;
      box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.14);
      outline: none;
    }

    button {
      background: #0f766e;
      border: 1px solid #0f766e;
      border-radius: 7px;
      color: #ffffff;
      cursor: pointer;
      font: inherit;
      font-weight: 800;
      min-height: 44px;
      padding: 10px 14px;
    }

    button:hover { background: #0b625c; }

    .auth-button {
      background: #0f766e;
      border: 1px solid #0f766e;
      border-radius: 7px;
      color: #ffffff;
      display: block;
      font-weight: 800;
      min-height: 44px;
      padding: 11px 14px;
      text-align: center;
      text-decoration: none;
    }

    .helper, .auth-switch {
      color: #657386;
      font-size: 0.9rem;
      line-height: 1.45;
    }

    small {
      color: #7b8794;
      font-size: 0.76rem;
      font-weight: 500;
      line-height: 1.35;
    }

    .error, .success {
      border-radius: 7px;
      font-size: 0.9rem;
      padding: 10px;
    }

    .error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #991b1b;
    }

    .success {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #065f46;
    }

    .auth-switch { text-align: center; }
    a { color: #0f766e; font-weight: 800; }
  `;
}

function escapeHtmlServer(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toMysqlDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return toMysqlDateTime(new Date().toISOString());
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function toIsoLike(value) {
  return value ? `${value}.000Z` : new Date().toISOString();
}

function cryptoRandomId() {
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function validateDatabaseName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error("DB_NAME can only contain letters, numbers, and underscores");
  }
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
    // .env is optional; .env.example documents the expected values.
  }
}
