ALTER TABLE `asset_assignments`
ADD COLUMN `gate_pass_document_id` int DEFAULT NULL,
ADD CONSTRAINT `aa_gate_pass_fk` FOREIGN KEY (`gate_pass_document_id`) REFERENCES `documents` (`id`) ON DELETE SET NULL;
