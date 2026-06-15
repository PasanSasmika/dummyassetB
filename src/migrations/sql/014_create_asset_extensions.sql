CREATE TABLE `asset_human` (
  `asset_id` int NOT NULL,
  `designation_id` int NOT NULL,
  `department_id` int NOT NULL,
  `assigned_employee_id` int DEFAULT NULL,
  PRIMARY KEY (`asset_id`),
  KEY `designation_id` (`designation_id`),
  KEY `department_id` (`department_id`),
  KEY `assigned_employee_id` (`assigned_employee_id`),
  CONSTRAINT `asset_human_ibfk_1` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `asset_human_ibfk_2` FOREIGN KEY (`designation_id`) REFERENCES `designations` (`id`),
  CONSTRAINT `asset_human_ibfk_3` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`),
  CONSTRAINT `asset_human_ibfk_4` FOREIGN KEY (`assigned_employee_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `asset_it_infrastructure` (
  `asset_id` int NOT NULL,
  `manufacturer` varchar(100) DEFAULT NULL,
  `model` varchar(100) DEFAULT NULL,
  `serial_number` varchar(100) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `mac_address` varchar(17) DEFAULT NULL,
  PRIMARY KEY (`asset_id`),
  UNIQUE KEY `serial_number` (`serial_number`),
  CONSTRAINT `asset_it_infrastructure_ibfk_1` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `asset_end_user` (
  `asset_id` int NOT NULL,
  `device_type` enum('Laptop','Desktop','Printer','Mobile','Other') DEFAULT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `model` varchar(100) DEFAULT NULL,
  `date_of_purchase` date DEFAULT NULL,
  `serial_number` varchar(100) DEFAULT NULL,
  `condition` enum('Brand New','Used') DEFAULT NULL,
  PRIMARY KEY (`asset_id`),
  CONSTRAINT `asset_end_user_ibfk_1` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `asset_facility` (
  `asset_id` int NOT NULL,
  `facility_type` enum('Meeting Room','Discussion Room','Building','Working Area') DEFAULT NULL,
  `building_name` varchar(150) DEFAULT NULL,
  `floor_level` varchar(50) DEFAULT NULL,
  `capacity` int DEFAULT NULL,
  PRIMARY KEY (`asset_id`),
  CONSTRAINT `asset_facility_ibfk_1` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `asset_service` (
  `asset_id` int NOT NULL,
  `provider_name` varchar(150) DEFAULT NULL,
  `contact_person` varchar(150) DEFAULT NULL,
  `sla_document_ref` varchar(255) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  PRIMARY KEY (`asset_id`),
  CONSTRAINT `asset_service_ibfk_1` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `asset_digital` (
  `asset_id` int NOT NULL,
  `version_number` varchar(50) DEFAULT NULL,
  `license_key` varchar(255) DEFAULT NULL,
  `digital_storage_path` varchar(255) DEFAULT NULL,
  `encryption_algorithm` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`asset_id`),
  CONSTRAINT `asset_digital_ibfk_1` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `asset_tangible_info` (
  `asset_id` int NOT NULL,
  `document_type` varchar(100) DEFAULT NULL,
  `storage_safes_location` varchar(200) DEFAULT NULL,
  `retention_period_days` int DEFAULT NULL,
  PRIMARY KEY (`asset_id`),
  CONSTRAINT `asset_tangible_info_ibfk_1` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
