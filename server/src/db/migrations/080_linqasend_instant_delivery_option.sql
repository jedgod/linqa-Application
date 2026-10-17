-- The optional sender-paid fee is "instant delivery": it lets the receiver deposit from their wallet to a bank/card instantly.
ALTER TABLE linqasend_quotes DROP CONSTRAINT IF EXISTS linqasend_quotes_delivery_option_check;
UPDATE linqasend_quotes SET delivery_option='instant' WHERE delivery_option='same_day';
ALTER TABLE linqasend_quotes ADD CONSTRAINT linqasend_quotes_delivery_option_check CHECK (delivery_option IN ('standard','instant'));
