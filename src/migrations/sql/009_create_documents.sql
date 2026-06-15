CREATE TABLE `documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` enum('Asset','Warranty','Ticket','Repair','Assignment','Part') NOT NULL,
  `entity_id` int NOT NULL,
  `document_type` enum('PO','CAPEX','OPEX','Warranty','Custom','Other') DEFAULT 'Other',
  `document_name` varchar(255) NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `uploaded_by` int DEFAULT NULL,
  `uploaded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_entity` (`entity_type`,`entity_id`),
  KEY `uploaded_by` (`uploaded_by`),
  CONSTRAINT `documents_ibfk_1` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
