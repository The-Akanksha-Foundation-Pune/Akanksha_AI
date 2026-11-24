-- The person's Google profile picture, shown beside their name in the sidebar. Filled in at sign-in
-- (from Google, or from the token Tether hands over); NULL until the person next signs in.
ALTER TABLE users
  ADD COLUMN picture_url VARCHAR(1024) NULL;
