//migrations/20261018143000_create_authoritative_immutable_subledger.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Structural Ledger Entry Records (Double-Entry Core System)
  await knex.schema.createTable('wallet_ledger_postings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('wallet_account_id').notNullable().references('id').inTable('linqasend_wallet_accounts_v2').onDelete('RESTRICT');
    table.string('transaction_correlation_id').notNullable().index(); // Ties legs together (FX, Fee, Transfer)
    table.string('provider_operation_key').nullable().unique(); // Global constraint blocking double entry attempts
    
    // Explicitly define distinct transaction balance channels
    table.enum('balance_type', ['POSTED', 'PENDING_INCOMING', 'HELD_RESERVATION']).notNullable();
    
    // Signed integers track balance movements down to the lowest minor currency denomination (cents, satoshis)
    table.bigInteger('amount_minor_units').notNullable(); 
    table.string('currency_iso_code', 3).notNullable();
    
    table.string('accounting_journal_code').notNullable(); // e.g., 'CUSTOMER_WITHDRAWAL', 'TRANSFER_SETTLEMENT'
    table.timestamp('posted_at', { useTz: true }).defaultTo(knex.fn.now()).index();
  });

  // 2. Transmit Outbox Container for Reliable Asynchronous Processing
  await knex.schema.createTable('wallet_transaction_outbox', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('aggregate_type').notNullable().defaultTo('WALLET_WITHDRAWAL');
    table.string('aggregate_id').notNullable();
    table.string('event_type').notNullable(); // e.g., 'WITHDRAWAL_LEASED'
    table.jsonb('payload_data').notNullable();
    table.enum('status_state', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).notNullable().defaultTo('PENDING');
    table.integer('retry_attempts_count').notNullable().defaultTo(0);
    table.string('lease_owner_id').nullable();
    table.timestamp('lease_expires_at', { useTz: true }).nullable();
    table.timestamps(true, true);

    table.index(['status_state', 'lease_expires_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('wallet_transaction_outbox');
  await knex.schema.dropTableIfExists('wallet_ledger_postings');
}