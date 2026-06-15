-- Closes the circular dependency: departments.head_of_department -> users.id
ALTER TABLE `departments`
  ADD KEY `fk_dept_head` (`head_of_department`),
  ADD CONSTRAINT `fk_dept_head` FOREIGN KEY (`head_of_department`) REFERENCES `users` (`id`) ON DELETE SET NULL;
