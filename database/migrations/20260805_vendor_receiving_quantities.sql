ALTER TABLE customer_credit_vendor_tracking
  ADD COLUMN IF NOT EXISTS accepted_quantity INT NOT NULL DEFAULT 0 AFTER spoiled_quantity;

UPDATE customer_credit_vendor_tracking
SET received_quantity = quantity, accepted_quantity = quantity
WHERE received_quantity = 0 AND spoiled_quantity = 0 AND accepted_quantity = 0;

UPDATE customer_credit_vendor_tracking
SET accepted_quantity = GREATEST(received_quantity - spoiled_quantity, 0)
WHERE accepted_quantity = 0 AND received_quantity > spoiled_quantity;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
