CREATE TABLE `designations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `department_id` int NOT NULL,
  `title` varchar(150) NOT NULL,
  `default_cia_confidentiality` tinyint NOT NULL DEFAULT '1',
  `default_cia_integrity` tinyint NOT NULL DEFAULT '1',
  `default_cia_availability` tinyint NOT NULL DEFAULT '1',
  `default_asset_value` tinyint DEFAULT NULL,
  `default_classification` varchar(50) DEFAULT NULL,
  `default_color_code` varchar(20) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `department_id` (`department_id`,`title`),
  CONSTRAINT `designations_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `designations_chk_1` CHECK ((`default_cia_confidentiality` between 1 and 3)),
  CONSTRAINT `designations_chk_2` CHECK ((`default_cia_integrity` between 1 and 3)),
  CONSTRAINT `designations_chk_3` CHECK ((`default_cia_availability` between 1 and 3))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
