'use strict';
// Task031 diagnostic: isolated PostgreSQL only. A failure is evidence, not a fix.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../configs/database');
const { upsertOrder, upsertAbandonedCart } = require('../services/commerceWebhookService');
if (process.env.TASK031_ISOLATED_DB !== 'true' || !String(process.env.DATABASE_URL || '').includes('@127.0.0.1:5432/task031')) {
  throw new Error('Disposable task031 PostgreSQL required');
}
const id = randomUUID(), prefix = 'task031-' + id.slice(0,8);
const store = { id: randomUUID(), platform: 'shopify' };
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); }
  catch (e) { results.push({ name, status: 'FAIL', error: e.message.slice(0,220) }); }
}
async function main() {
  const user = randomUUID(), org = randomUUID();
  try {
    await prisma.users.create({ data: { id:user, full_name:'Task031 Test', email:prefix+'@example.invalid' } });
    await prisma.organizations.create({ data: { id:org, owner_id:user, company_name:'Task031', industry:'other', country:'US', slug:prefix } });
    await prisma.stores.create({ data: { id:store.id, organization_id:org, platform:'shopify', shop_domain:prefix+'.myshopify.com' } });
    const token = prefix+'-checkout-token', externalOrder = prefix+'-order', checkoutId = prefix+'-checkout';
    const orderPayload = { id:externalOrder, checkout_token:token, created_at:'2026-10-30T08:00:00Z', total_price:'25', current_total_price:'25', currency:'USD' };
    await check('TC031-02-order-durable-without-checkout', async () => {
      await upsertOrder(store,'shopify',orderPayload);
      const o = await prisma.orders.findFirstOrThrow({ where:{store_id:store.id,external_order_id:externalOrder} });
      assert.equal(o.abandoned_cart_id,null);
      assert.equal(o.source_checkout_token,token);
      assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id}}),0);
    });
    await check('TC031-01-order-first-later-checkout-reconciles', async () => {
      await upsertAbandonedCart(store,{ id:checkoutId, token, created_at:'2026-10-30T07:55:00Z', updated_at:'2026-10-30T08:01:00Z', total_price:'25',currency:'USD' });
      const o = await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:externalOrder}});
      const c = await prisma.abandoned_carts.findFirstOrThrow({where:{store_id:store.id,external_cart_id:checkoutId}});
      assert.equal(o.abandoned_cart_id,c.id,'Later checkout must reconcile the previously persisted order');
      assert.equal(c.status,'recovered','Verified completed order must override abandonment');
    });
    const mkOrder = (suffix, token, extra = {}) => ({ id:prefix+'-order-'+suffix,
      checkout_token:token, created_at:'2026-10-30T08:00:00Z',
      total_price:'25', current_total_price:'25', currency:'USD', ...extra });
    const mkCheckout = (suffix, token, extra = {}) => ({ id:prefix+'-checkout-'+suffix,
      token, created_at:'2026-10-30T07:55:00Z',
      updated_at:'2026-10-30T08:01:00Z', total_price:'25',currency:'USD', ...extra });
    const getOrder = suffix => prisma.orders.findFirstOrThrow({where:{
      store_id:store.id, external_order_id:prefix+'-order-'+suffix }});
    await check('TC031-03-unrelated-checkout-does-not-claim-order', async () => {
      const t=prefix+'-unrelated';
      await upsertOrder(store,'shopify',mkOrder('unrelated',t));
      await upsertAbandonedCart(store,mkCheckout('unrelated',prefix+'-different'));
      assert.equal((await getOrder('unrelated')).abandoned_cart_id,null);
    });
    await check('TC031-04-order-first-idempotent-repeated-checkout', async () => {
      const t=prefix+'-idempotent';
      await upsertOrder(store,'shopify',mkOrder('idempotent',t));
      await upsertAbandonedCart(store,mkCheckout('idempotent',t));
      await upsertAbandonedCart(store,mkCheckout('idempotent',t));
      const o=await getOrder('idempotent');
      assert.ok(o.abandoned_cart_id);
      assert.equal(await prisma.abandoned_carts.count({where:{store_id:store.id,
        external_cart_id:prefix+'-checkout-idempotent'}}),1);
      assert.equal(await prisma.orders.count({where:{store_id:store.id,
        abandoned_cart_id:o.abandoned_cart_id}}),1);
    });
    await check('TC031-05-second-order-cannot-claim-owned-checkout', async () => {
      const t=prefix+'-owned';
      await upsertOrder(store,'shopify',mkOrder('owned-a',t));
      await upsertOrder(store,'shopify',mkOrder('owned-b',t));
      await upsertAbandonedCart(store,mkCheckout('owned',t));
      const a=await getOrder('owned-a'),b=await getOrder('owned-b');
      const claimed=[a,b].filter(x=>x.abandoned_cart_id);
      assert.equal(claimed.length,1);
      assert.equal(a.abandoned_cart_id===b.abandoned_cart_id,false);
    });
    await check('TC031-06-cross-merchant-identity-isolation', async () => {
      const otherStore={id:randomUUID(),platform:'shopify'};
      await prisma.stores.create({data:{id:otherStore.id,organization_id:org,
        platform:'shopify',shop_domain:prefix+'-other.myshopify.com'}});
      const t=prefix+'-cross-merchant';
      await upsertOrder(store,'shopify',mkOrder('cross-merchant',t));
      await upsertAbandonedCart(otherStore,mkCheckout('cross-merchant',t));
      assert.equal((await getOrder('cross-merchant')).abandoned_cart_id,null);
    });
    await check('TC031-08-cancelled-order-does-not-mark-recovered', async () => {
      const t=prefix+'-cancelled';
      await upsertOrder(store,'shopify',mkOrder('cancelled',t));
      const o=await getOrder('cancelled');
      await prisma.orders.update({where:{id:o.id},data:{recovery_status:'cancelled'}});
      await upsertAbandonedCart(store,mkCheckout('cancelled',t));
      const c=await prisma.abandoned_carts.findFirstOrThrow({where:{
        store_id:store.id,external_cart_id:prefix+'-checkout-cancelled'}});
      assert.notEqual(c.status,'recovered');
    });
    await check('TC031-09-replay-does-not-reopen-recovered', async () => {
      const t=prefix+'-replay';
      await upsertOrder(store,'shopify',mkOrder('replay',t));
      await upsertAbandonedCart(store,mkCheckout('replay',t));
      await upsertAbandonedCart(store,mkCheckout('replay',t,{
        updated_at:'2026-10-30T07:54:00Z'}));
      const c=await prisma.abandoned_carts.findFirstOrThrow({where:{
        store_id:store.id,external_cart_id:prefix+'-checkout-replay'}});
      assert.equal(c.status,'recovered');
    });
    await check('TC031-07-duplicate-checkout-still-reconciles', async () => {
      await upsertAbandonedCart(store,{ id:checkoutId, token, created_at:'2026-10-30T07:55:00Z', updated_at:'2026-10-30T08:02:00Z', total_price:'25',currency:'USD' });
      const o = await prisma.orders.findFirstOrThrow({where:{store_id:store.id,external_order_id:externalOrder}});
      const c = await prisma.abandoned_carts.findFirstOrThrow({where:{store_id:store.id,external_cart_id:checkoutId}});
      assert.equal(o.abandoned_cart_id,c.id);
    });
  } finally {
    console.log('TASK031_RESULTS='+JSON.stringify(results));
    console.log('TASK031_SUMMARY='+JSON.stringify({pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,total:results.length}));
    await prisma.$disconnect();
  }
  if (results.some(r=>r.status==='FAIL')) process.exitCode=1;
}
main().catch(e=>{console.error('TASK031_FATAL='+e.message);process.exitCode=1;});
