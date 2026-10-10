# v3.0 — LinqaSend transaction-grade binding

The authorization resource is created from server-authoritative transfer data, never from client-supplied amount/recipient fields. The transfer is locked/read in a transaction; its immutable authorization snapshot is hashed. If amount, currency, recipient, rail, quote, fee, transfer version or action changes, the old grant cannot be consumed.
