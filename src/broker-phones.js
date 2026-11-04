'use strict';

// Amir 2026-11-04: every broker has one phone, kept in public.brokers
// (nir-buyers-agent sql/020). A listing with no phone takes its broker's; a
// broker seen with a phone for the first time joins the table. Lets ▶ in the
// dashboard reach the broker without Amir typing the number.

const { createClient } = require('@supabase/supabase-js');

async function fillBrokerPhones(listings) {
  if (!listings.length) return 0;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await supabase.from('brokers').select('name,phone');
  if (error) throw new Error(error.message); // no sql/020 yet: listings keep what they have
  const byName = new Map((data || []).filter((b) => b.phone).map((b) => [b.name, b.phone]));
  let filled = 0;
  const fresh = [];
  for (const l of listings) {
    if (!l.broker_name) continue;
    if (!l.broker_phone && byName.has(l.broker_name)) {
      l.broker_phone = byName.get(l.broker_name);
      filled++;
    } else if (l.broker_phone && !byName.has(l.broker_name)) {
      byName.set(l.broker_name, l.broker_phone);
      fresh.push({ name: l.broker_name, phone: l.broker_phone, source: 'group_author' });
    }
  }
  if (fresh.length) await supabase.from('brokers').upsert(fresh, { onConflict: 'name', ignoreDuplicates: true });
  return filled;
}

module.exports = { fillBrokerPhones };
