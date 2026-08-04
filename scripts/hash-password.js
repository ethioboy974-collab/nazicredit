const crypto = require("node:crypto");

const password = process.argv.slice(2).join(" ");
if (!password) {
  console.error("Usage: node scripts/hash-password.js \"your store password\"");
  process.exit(1);
}

const iterations = 210000;
const salt = crypto.randomBytes(16).toString("base64url");

crypto.pbkdf2(password, salt, iterations, 32, "sha256", (error, derivedKey) => {
  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`pbkdf2_sha256$${iterations}$${salt}$${derivedKey.toString("base64url")}`);
});
