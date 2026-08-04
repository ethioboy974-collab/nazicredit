CREATE DATABASE IF NOT EXISTS customer_credit
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE customer_credit;

CREATE TABLE IF NOT EXISTS customer_credit_enterprises (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customer_credit_enterprise_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  UNIQUE KEY uq_customer_credit_user_enterprise_email (enterprise_id, email),
  INDEX idx_customer_credit_users_enterprise (enterprise_id),
  CONSTRAINT fk_customer_credit_users_enterprise
    FOREIGN KEY (enterprise_id) REFERENCES customer_credit_enterprises(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_credit_vendor_tracking (
  id VARCHAR(64) PRIMARY KEY,
  enterprise_id VARCHAR(64) NOT NULL,
  vendor_name VARCHAR(160) NOT NULL,
  contact_name VARCHAR(160) NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit VARCHAR(40) NOT NULL DEFAULT 'piece',
  received_quantity INT NOT NULL DEFAULT 0,
  spoiled_quantity INT NOT NULL DEFAULT 0,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_credit_meat_order_items (
  id VARCHAR(64) PRIMARY KEY, order_id VARCHAR(64) NOT NULL, enterprise_id VARCHAR(64) NOT NULL,
  product_name VARCHAR(160) NOT NULL, quantity DECIMAL(12,3) NOT NULL, unit VARCHAR(40) NOT NULL,
  special_instructions VARCHAR(500) NULL, price DECIMAL(12,2) NULL, position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_meat_order_items_order (order_id, position), INDEX idx_meat_order_items_enterprise (enterprise_id),
  CONSTRAINT fk_meat_order_items_order FOREIGN KEY (order_id) REFERENCES customer_credit_meat_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_meat_order_items_enterprise FOREIGN KEY (enterprise_id) REFERENCES customer_credit_enterprises(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_credit_records (
  id VARCHAR(64) PRIMARY KEY,
  enterprise_id VARCHAR(64) NOT NULL,
  customer_name VARCHAR(160) NOT NULL,
  customer_phone VARCHAR(60) NULL,
  item_note VARCHAR(255) NOT NULL,
  credit_date DATE NOT NULL,
  credit_time TIME NULL,
  credit_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customer_credit_records_enterprise_updated (enterprise_id, updated_at),
  INDEX idx_customer_name (customer_name),
  INDEX idx_credit_date (credit_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  r.updated_at;
