CREATE TABLE `repair_parts` (
  `repair_id` int NOT NULL,
  `part_id` int NOT NULL,
  `quantity_used` int DEFAULT '1',
  `part_cost_at_time` decimal(10,2) DEFAULT '0.00',
  PRIMARY KEY (`repair_id`,`part_id`),
  KEY `part_id` (`part_id`),
  CONSTRAINT `repair_parts_ibfk_1` FOREIGN KEY (`repair_id`) REFERENCES `asset_repairs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `repair_parts_ibfk_2` FOREIGN KEY (`part_id`) REFERENCES `parts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
