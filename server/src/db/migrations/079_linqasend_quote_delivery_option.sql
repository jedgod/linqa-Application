-- Delivery speed chosen when the quote was made. Same-day delivery carries a sender fee (stored in sender_fee_minor).
ALTER TABLE linqasend_quotes ADD COLUMN delivery_option TEXT NOT NULL DEFAULT 'standard' CHECK (delivery_option IN ('standard','same_day'));
