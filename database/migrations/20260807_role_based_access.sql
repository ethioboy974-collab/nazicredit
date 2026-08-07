-- Non-destructive role normalization and login audit history.
ALTER TABLE customer_credit_users
  MODIFY COLUMN role ENUM('owner','employee','staff','viewer') NOT NULL DEFAULT 'employee';

UPDATE customer_credit_users SET role = 'employee' WHERE role IN ('staff','viewer');

ALTER TABLE customer_credit_users
  MODIFY COLUMN role ENUM('owner','employee') NOT NULL DEFAULT 'employee';

CREATE TABLE IF NOT EXISTS customer_credit_login_history (
  id VARCHAR(64) PRIMARY KEY,
  enterprise_id VARCHAR(64) NULL,
  enterprise_code VARCHAR(80) NOT NULL,
  user_id VARCHAR(64) NULL,
  username VARCHAR(80) NOT NULL,
  outcome ENUM('success', 'failed') NOT NULL,
  ip_address VARCHAR(80) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_history_enterprise_created (enterprise_id, created_at),
  INDEX idx_login_history_username_created (enterprise_code, username, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
