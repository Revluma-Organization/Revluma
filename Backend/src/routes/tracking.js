const express = require('express');

function createTrackingPixelRouter(prisma) {
  const router = express.Router();

  router.post('/cart', express.json(), async (req, res) => {
    try {
      const { storeId, sessionId, email, items, url, event } = req.body;

      if (!storeId || !sessionId) {
        return res.status(400).json({ error: 'Missing storeId or sessionId' });
      }

      const store = await prisma.storeConfig.findUnique({
        where: { id: storeId },
        include: { credentials: true },
      });

      if (!store || store.platform !== 'WOOCOMMERCE') {
        return res.status(404).json({ error: 'Store not found or not WooCommerce' });
      }

      if (store.cartTrackingMode === 'none') {
        return res.status(200).json({ message: 'Tracking disabled' });
      }

      const now = new Date();
      const windowMs = store.abandonmentWindowMinutes * 60 * 1000;

      const existingCheckout = await prisma.checkout.findFirst({
        where: {
          storeId,
          externalId: sessionId,
        },
      });

      if (existingCheckout) {
        await prisma.checkout.update({
          where: { id: existingCheckout.id },
          data: {
            email: email || existingCheckout.email,
            lineItems: items || existingCheckout.lineItems,
            lastActivityAt: now,
            status: event === 'checkout_started' ? 'ACTIVE' : existingCheckout.status,
          },
        });
      } else {
        const totalPrice = items?.reduce((sum, item) => sum + (item.price * item.quantity), 0) || 0;

        await prisma.checkout.create({
          data: {
            storeId,
            platform: 'WOOCOMMERCE',
            externalId: sessionId,
            email: email || null,
            phone: null,
            status: event === 'checkout_started' ? 'ACTIVE' : 'UNKNOWN',
            lineItems: items || [],
            totalPrice,
            currency: 'USD',
            lastActivityAt: now,
          },
        });
      }

      res.status(200).json({ received: true });

    } catch (error) {
      console.error('[tracking] Error processing cart event:', error);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.get('/script/:storeId', async (req, res) => {
    try {
      const { storeId } = req.params;

      const store = await prisma.storeConfig.findUnique({
        where: { id: storeId },
      });

      if (!store || store.cartTrackingMode === 'none') {
        return res.status(404).send('Tracking not enabled');
      }

      const trackingEndpoint = process.env.TRACKING_ENDPOINT || 
        `${req.protocol}://${req.get('host')}/api/tracking/cart`;

      const script = `
;(function(w, d, storeId, endpoint) {
  'use strict'

  const DEBOUNCE_MS = 2000
  let debounceTimer = null
  let sessionId = null

  function getOrCreateSession() {
    if (sessionId) return sessionId
    let id = sessionStorage.getItem('_rlm_sid')
    if (!id) { 
      id = '${Date.now()}_' + Math.random().toString(36).substr(2, 9)
      sessionStorage.setItem('_rlm_sid', id) 
    }
    sessionId = id
    return id
  }

  function getCartEmail() {
    const el = d.querySelector('#billing_email')
    return el ? el.value : null
  }

  function extractCartItems() {
    const items = []
    d.querySelectorAll('.woocommerce-cart-form__contents tr').forEach(function(row) {
      const qty = row.querySelector('.qty')
      const name = row.querySelector('.product-name a')
      const price = row.querySelector('.product-price .woocommerce-Price-amount')
      if (qty && name) {
        items.push({
          title: name.textContent.trim(),
          quantity: parseFloat(qty.value) || 1,
          price: price ? parseFloat(price.textContent.replace(/[^0-9.]/g, '')) : 0
        })
      }
    })
    return items
  }

  function sendEvent(eventType, cartData) {
    const payload = {
      event: eventType,
      sessionId: getOrCreateSession(),
      storeId: storeId,
      email: getCartEmail(),
      items: cartData,
      url: location.href,
      ts: Date.now()
    }
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, JSON.stringify(payload))
    } else {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      })
    }
  }

  if (w.jQuery) {
    jQuery(d).on('added_to_cart', function(e, fragments, cartHash, button) {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(function() {
        sendEvent('cart_updated', extractCartItems())
      }, DEBOUNCE_MS)
    })

    jQuery(d).on('updated_cart', function() {
      sendEvent('cart_updated', extractCartItems())
    })
  }

  if (d.querySelector('.woocommerce-checkout')) {
    sendEvent('checkout_started', extractCartItems())
  }

  const checkoutForm = d.querySelector('form.woocommerce-checkout')
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', function() {
      sendEvent('checkout_started', extractCartItems())
    })
  }

})(window, document, '${storeId}', '${trackingEndpoint}');
`;

      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(script);

    } catch (error) {
      console.error('[tracking] Error generating script:', error);
      res.status(500).send('Error');
    }
  });

  return router;
}

module.exports = { createTrackingPixelRouter };