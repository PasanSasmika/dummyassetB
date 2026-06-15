ALTER TABLE `documents`
MODIFY COLUMN `document_type` enum('PO','CAPEX','OPEX','Warranty','Custom','Other','Gate Pass') DEFAULT 'Other';
