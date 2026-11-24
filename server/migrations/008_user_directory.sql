-- Access is given by a super admin (Admin > Access), as in Alumni Connect: a person is picked from the employee
-- directory (AFDW.employees, read-only) by team, then name. Team, designation and employee code are copied
-- from the directory at the time of adding; added_by is the super admin's email.
ALTER TABLE users
  ADD COLUMN team          VARCHAR(191) NULL,
  ADD COLUMN designation   VARCHAR(191) NULL,
  ADD COLUMN employee_code VARCHAR(191) NULL,
  ADD COLUMN added_by      VARCHAR(255) NULL,
  ADD KEY idx_users_team (team);
