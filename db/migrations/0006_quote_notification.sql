-- Notification type for quote lifecycle events (viewed / signed / declined).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'quote_update';
