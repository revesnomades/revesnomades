/**
 * Meta Pixel (Facebook Pixel) Tracking Module - Âmes Nomades
 * Pixel ID: 27710195578608730
 */
(function() {
  const PIXEL_ID = '27710195578608730';

  // Prevent duplicate initialization
  if (window.fbq) return;

  const fbq = function() {
    fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
  };
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  const firstScript = document.getElementsByTagName('script')[0];
  if (firstScript && firstScript.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }

  window.fbq = fbq;

  // Initialize and track PageView
  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

  // Expose helper methods globally
  window.MetaPixel = {
    track: function(eventName, params, eventId) {
      if (typeof window.fbq === 'function') {
        if (eventId) window.fbq('track', eventName, params, { eventID: String(eventId) });
        else window.fbq('track', eventName, params);
      }
    },
    trackViewContent: function(name, category, id, value) {
      this.track('ViewContent', {
        content_name: name,
        content_category: category,
        content_ids: [id],
        content_type: 'product',
        value: Number(value) || 0,
        currency: 'EUR'
      });
    },
    trackAddToCart: function(name, id, value) {
      this.track('AddToCart', {
        content_name: name,
        content_ids: [id],
        content_type: 'product',
        value: Number(value) || 0,
        currency: 'EUR'
      });
    },
    trackInitiateCheckout: function(value) {
      this.track('InitiateCheckout', {
        value: Number(value) || 0,
        currency: 'EUR'
      });
    },
    // value : montant payé (null si inconnu) ; orderId : identifiant unique de la commande
    trackPurchase: function(value, orderId, items) {
      const params = { currency: 'EUR' };
      if (value != null && Number.isFinite(Number(value))) params.value = Number(value);
      if (Array.isArray(items) && items.length) {
        params.contents = items.map(function (i) { return { id: String(i.id || i.name), quantity: Number(i.qty) || 1, item_price: Number(i.price) || 0 }; });
        params.content_ids = params.contents.map(function (c) { return c.id; });
        params.content_type = 'product';
        params.num_items = params.contents.reduce(function (n, c) { return n + c.quantity; }, 0);
      }
      if (orderId) params.order_id = String(orderId);
      this.track('Purchase', params, orderId);
    },
    trackContact: function(method = 'Formulaire de contact') {
      this.track('Contact', {
        content_category: method
      });
    }
  };
})();
