
📘 Module 2: Enterprise Architecture Design Document (ADD)

Document Reference: ADD-2026-LQA-002
System Designation: Linqa Authoritative Customer Balance Subledger Architecture
Security Classification: Highly Confidential – Internal Engineering Distribution Only

1. System Engineering Context & Scope

This document specifies the technical pattern implementations designed to remediate the architectural gaps identified inside the Wallet Structure Additional Assessment (Section 8). The implementation moves the platform away from a highly volatile, mutable column data state tracking approach (which mimics per-transfer cash-out entitlements) to an immutable double-entry accounting subledger architecture.

2. Core Architectural Design Conventions

• Authoritative Postings Foundation: Balances are no longer treated as individual scalar values updateable inside a database table cell. Stored values are mathematical aggregates reconstructed via high-performance query indexing channels:
\(\text{Available\ Balance}=\sum (\text{Postings}_{\text{Minor\ Units}}\mid \text{Balance\ Type}={}^{\prime }\text{POSTED}^{\prime })\)
• Durable Outbox State Engine: All fund disbursement maneuvers utilize a transactional pattern. Payout records are written atomically alongside internal ledger holds into a database wallet_transaction_outbox table in a single atomic database event. This guarantees message delivery and idempotency, even during background worker failures or total system disconnections.
• Perimeter Role Isolation Gating: The reverse proxies enforce strict data boundaries. Any incoming mobile transaction matching the user role STUDENT attempting access to paths belonging to administrative panels (/api/admin/, /api/staff/) will be immediately terminated with an HTTP 403 Forbidden payload.

📊 Module 3: App Store & Google Play Production Release Checklist

This deployment manual details the quality assurance steps and console properties required to submit the finalized binary packages for review.

Submission Track	Production-Grade Action Items & Pass Criteria	Platform Focus	Verification Method
1. Entitlements Register	Configure explicit Associated Domains entries inside your signing certificates matching your custom payment endpoints.	iOS	Run a verification validation check against the compiled target Entitlements.plist file array.
2. Universal Linking	Deploy the updated, cryptographic-compliant site registration asset configuration payload down your public endpoints.	iOS	Run an automated script to verify the return status of https://*://.
3. ProGuard Obfuscation	Enable native R8 compilation rules to minify dependency components, clean source maps, and compress binary asset footings.	Android	Execute an interior decompilation check using an extracted Android App Bundle (.aab) test target.
4. Digital Asset Links	Deploy the corresponding SHA-256 app certificate fingerprints into your public web endpoint assets repository.	Android	Execute the Google Digital Asset Links Evaluation API to confirm clean intent mapping configurations.
5. Privacy Shielding	Update active console questionnaires explaining exactly how financial subledger transaction caches are isolated in secure storage.	Both	Complete the mandatory structural App Privacy Declarations inside App Store Connect and Google Play Console.


Module 3: AES-256-GCM Cryptographic Schema for PII Data Encryption

This specification encrypts PII columns (such as recipient account numbers, legal names, and routing keys) inside your transactional database records before cold archiving. It relies on Authenticated AES-256-GCM to enforce structural security boundaries.
                  COLD STORAGE PII ENCRYPTION SCHEME
                  
   Cleartext Row          AES-256-GCM Crypto Tunnel          Encrypted Ledger Asset
+-----------------+      +---------------------------+      +-----------------------+

|                 |      | * Generate 12-Byte IV     |      | * Ciphertext Base64   |
|  Account Name   |=====>| * Encrypt with 32-Byte Key|=====>| * IV Vector Hex       |
|  Routing Number |      | * Compute Auth Tag (16B)  |      | * Auth Tag Hex        |
+-----------------+      +---------------------------+      +-----------------------+
