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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE customer_credit_vendor_tracking
  ADD COLUMN IF NOT EXISTS vendor_account_id VARCHAR(64) NULL AFTER enterprise_id,
  ADD INDEX IF NOT EXISTS idx_vendor_tracking_account (enterprise_id, vendor_account_id);
