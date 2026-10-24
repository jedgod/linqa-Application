exports.up = async function (knex) {
  await knex.schema.createTable('linqa_notes', t => {
    t.string('id', 36).primary(); t.string('user_id', 128).notNullable().index();
    t.string('title', 200).notNullable().defaultTo(''); t.text('body').notNullable().defaultTo('');
    t.string('category', 40).notNullable().defaultTo('Personal'); t.text('tags_json').notNullable().defaultTo('[]');
    t.boolean('pinned').notNullable().defaultTo(false); t.boolean('locked').notNullable().defaultTo(false);
    t.string('created_at', 40).notNullable(); t.string('updated_at', 40).notNullable(); t.index(['user_id', 'updated_at']);
  });
  await knex.schema.createTable('linqa_calendar_events', t => {
    t.string('id', 36).primary(); t.string('user_id', 128).notNullable().index();
    t.string('title', 200).notNullable(); t.text('description').notNullable().defaultTo('');
    t.string('start_at', 40).notNullable(); t.string('end_at', 40).notNullable();
    t.string('time_zone', 80).notNullable().defaultTo('UTC'); t.string('location', 300).notNullable().defaultTo('');
    t.string('meeting_url', 1000).notNullable().defaultTo(''); t.string('recurrence', 200).notNullable().defaultTo('');
    t.text('attendees_json').notNullable().defaultTo('[]'); t.string('created_at', 40).notNullable(); t.string('updated_at', 40).notNullable();
    t.index(['user_id', 'start_at']);
  });
  await knex.schema.createTable('linqa_organizations', t => {
    t.string('id', 36).primary(); t.string('name', 200).notNullable(); t.string('slug', 120).notNullable().unique();
    t.string('status', 30).notNullable().defaultTo('active'); t.string('plan', 80).notNullable().defaultTo('enterprise');
    t.string('data_region', 80).notNullable().defaultTo('unset'); t.string('created_at', 40).notNullable(); t.string('updated_at', 40).notNullable();
  });
  await knex.schema.createTable('linqa_org_members', t => {
    t.string('organization_id', 36).notNullable().references('id').inTable('linqa_organizations').onDelete('CASCADE');
    t.string('user_id', 128).notNullable(); t.string('role', 30).notNullable().defaultTo('member');
    t.string('status', 30).notNullable().defaultTo('active'); t.string('display_name', 200).notNullable().defaultTo('');
    t.string('created_at', 40).notNullable(); t.primary(['organization_id', 'user_id']); t.index(['user_id', 'status']);
  });
  await knex.schema.createTable('linqa_org_policies', t => {
    t.string('id', 36).primary(); t.string('organization_id', 36).notNullable().references('id').inTable('linqa_organizations').onDelete('CASCADE');
    t.string('name', 160).notNullable(); t.text('description').notNullable().defaultTo(''); t.boolean('enabled').notNullable().defaultTo(true);
    t.string('updated_at', 40).notNullable(); t.unique(['organization_id', 'name']);
  });
  await knex.schema.createTable('linqa_audit_log', t => {
    t.string('id', 36).primary(); t.string('organization_id', 36).notNullable().references('id').inTable('linqa_organizations').onDelete('CASCADE');
    t.string('actor_user_id', 128).notNullable(); t.string('action', 120).notNullable(); t.string('target_type', 80).notNullable().defaultTo('');
    t.string('target_id', 128).notNullable().defaultTo(''); t.string('created_at', 40).notNullable(); t.index(['organization_id', 'created_at']);
  });
  await knex.schema.createTable('linqa_privacy_preferences', t => {
    t.string('user_id', 128).primary(); t.boolean('discoverable').notNullable().defaultTo(true); t.boolean('read_receipts').notNullable().defaultTo(true);
    t.boolean('contact_sync').notNullable().defaultTo(false); t.boolean('personalized_recommendations').notNullable().defaultTo(true); t.string('updated_at', 40).notNullable();
  });
  await knex.schema.createTable('linqa_account_deletion_requests', t => {
    t.string('id', 36).primary(); t.string('user_id', 128).notNullable().index(); t.string('status', 40).notNullable().defaultTo('confirmation_required');
    t.string('requested_at', 40).notNullable(); t.string('confirmed_at', 40).nullable();
  });
};
exports.down = async function (knex) {
  for (const table of ['linqa_account_deletion_requests','linqa_privacy_preferences','linqa_audit_log','linqa_org_policies','linqa_org_members','linqa_organizations','linqa_calendar_events','linqa_notes']) await knex.schema.dropTableIfExists(table);
};
