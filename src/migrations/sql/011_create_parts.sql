CREATE TABLE `parts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `part_number` varchar(100) NOT NULL,
  `name` varchar(255) NOT NULL,
  `manufacturer` varchar(150) DEFAULT NULL,
  `cost` decimal(10,2) DEFAULT '0.00',
  `warranty_period_months` int DEFAULT '12',
  `stock_quantity` int DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `part_number` (`part_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
