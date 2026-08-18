import os
import sys
import logging
import argparse
import json
from typing import Dict, Any, Optional, List, Tuple
import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from requests.auth import HTTPBasicAuth
import dotenv


dotenv.load_dotenv(dotenv.find_dotenv())

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('woocommerce_sync')

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable not set")

WOO_API_VERSION = 'wc/v3'
PER_PAGE = 100
TIMEOUT = 30


def get_db_connection():
    return psycopg2.connect(DATABASE_URL)


def decode_credentials(access_token: str) -> Tuple[str, str]:
    """Decode 'consumer_key:consumer_secret'."""
    parts = access_token.split(':', 1)
    if len(parts) != 2:
        raise ValueError("Invalid access_token format: expected 'consumer_key:consumer_secret'")
    return parts[0], parts[1]


def build_shop_url(shop_domain: str) -> str:
    """Ensure the shop URL has a scheme. If not, add https://."""
    if not shop_domain.startswith(('http://', 'https://')):
        return f"https://{shop_domain}"
    return shop_domain


def should_verify_ssl(url: str) -> bool:
    """Return False for local development domains to bypass self‑signed certs."""
    local_domains = ['localhost', '127.0.0.1', 'revluma.local', '.local']
    for domain in local_domains:
        if domain in url:
            return False
    return True


def make_woo_request_with_headers(
    shop_domain: str,
    endpoint: str,
    consumer_key: str,
    consumer_secret: str,
    params: Optional[Dict[str, Any]] = None
) -> requests.Response:
    """
    Make authenticated request using HTTP Basic Auth over HTTPS.
    For local development, SSL verification is disabled.
    """
    base_url = build_shop_url(shop_domain)
    url = f"{base_url}/wp-json/{WOO_API_VERSION}/{endpoint.lstrip('/')}"
    auth = HTTPBasicAuth(consumer_key, consumer_secret)
    headers = {'Accept': 'application/json'}

    verify_ssl = should_verify_ssl(base_url)

    response = requests.get(
        url,
        params=params,
        auth=auth,
        headers=headers,
        timeout=TIMEOUT,
        verify=verify_ssl
    )
    response.raise_for_status()
    return response


def fetch_all_pages(
    shop_domain: str,
    endpoint: str,
    consumer_key: str,
    consumer_secret: str,
    per_page: int = PER_PAGE,
    extra_params: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """Fetch all pages of a WooCommerce endpoint using pagination."""
    page = 1
    all_items = []
    total_pages = 1

    while page <= total_pages:
        params = {'per_page': per_page, 'page': page}
        if extra_params:
            params.update(extra_params)

        try:
            response = make_woo_request_with_headers(
                shop_domain, endpoint, consumer_key, consumer_secret, params
            )
            data = response.json()
            headers = response.headers

            total_pages_header = headers.get('X-WP-TotalPages')
            if total_pages_header:
                total_pages = int(total_pages_header)
            else:
                if len(data) < per_page:
                    break
                total_pages = page

            if isinstance(data, list):
                all_items.extend(data)

            if len(data) < per_page:
                break

        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to fetch page {page} of {endpoint}: {str(e)}")
            if page == total_pages:
                break

        page += 1

    return all_items


def to_json(data):
    """Convert data to JSON string for PostgreSQL JSONB columns."""
    if data is None:
        return None
    if isinstance(data, (dict, list)):
        return json.dumps(data)
    return data


# ====================================================================
# SYNC FUNCTIONS – ONE PER DATA TYPE
# ====================================================================

def sync_woo_customers(store_id: str, db_conn):
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT shop_domain, access_token, organization_id
        FROM stores
        WHERE id = %s AND platform = 'woocommerce'
    """, (store_id,))
    store = cursor.fetchone()
    if not store:
        raise Exception(f"Store {store_id} not found")

    consumer_key, consumer_secret = decode_credentials(store['access_token'])
    shop_domain = store['shop_domain']

    logger.info(f"Starting customer sync for store {store_id}")

    try:
        customers = fetch_all_pages(
            shop_domain,
            'customers',
            consumer_key,
            consumer_secret,
            extra_params={'role': 'all'}
        )

        total = len(customers)
        logger.info(f"Fetched {total} customers from WooCommerce")

        for wc_cust in customers:
            first_name = wc_cust.get('first_name', '')
            last_name = wc_cust.get('last_name', '')
            full_name = f"{first_name} {last_name}".strip()
            if not full_name:
                full_name = 'Unknown'

            billing_phone = ''
            if wc_cust.get('billing') and wc_cust['billing'].get('phone'):
                billing_phone = wc_cust['billing']['phone']

            customer_data = {
                'store_id': store_id,
                'external_id': str(wc_cust['id']),
                'email': wc_cust.get('email', ''),
                'full_name': full_name,
                'phone': billing_phone,
                'orders_count': 0,
                'status': 'active',
                'consent_email': False,
                'consent_sms': False,
                'created_at': wc_cust.get('date_created'),
                'updated_at': wc_cust.get('date_modified'),
            }

            cursor.execute("""
                INSERT INTO customers (
                    store_id, external_id, email, full_name, phone,
                    orders_count, status, consent_email, consent_sms,
                    created_at, updated_at
                ) VALUES (
                    %(store_id)s, %(external_id)s, %(email)s, %(full_name)s,
                    %(phone)s, %(orders_count)s, %(status)s, %(consent_email)s,
                    %(consent_sms)s, %(created_at)s, %(updated_at)s
                )
                ON CONFLICT (store_id, external_id) DO UPDATE SET
                    email = EXCLUDED.email,
                    full_name = EXCLUDED.full_name,
                    phone = EXCLUDED.phone,
                    updated_at = EXCLUDED.updated_at
            """, customer_data)

        db_conn.commit()
        logger.info(f"Customer sync completed: {total} customers upserted for store {store_id}")

    except Exception as e:
        db_conn.rollback()
        logger.error(f"Customer sync failed for store {store_id}: {str(e)}")
        raise


def sync_woo_orders(store_id: str, db_conn):
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT shop_domain, access_token, organization_id
        FROM stores
        WHERE id = %s AND platform = 'woocommerce'
    """, (store_id,))
    store = cursor.fetchone()
    if not store:
        raise Exception(f"Store {store_id} not found")

    consumer_key, consumer_secret = decode_credentials(store['access_token'])
    shop_domain = store['shop_domain']

    logger.info(f"Starting order sync for store {store_id}")

    try:
        orders = fetch_all_pages(
            shop_domain,
            'orders',
            consumer_key,
            consumer_secret,
            extra_params={'status': 'any'}
        )

        total = len(orders)
        logger.info(f"Fetched {total} orders from WooCommerce")

        cursor.execute("""
            SELECT id, external_id FROM customers WHERE store_id = %s
        """, (store_id,))
        customer_map = {row['external_id']: row['id'] for row in cursor.fetchall()}

        for wc_order in orders:
            coupon_lines = wc_order.get('coupon_lines', [])
            coupon_used = len(coupon_lines) > 0
            coupon_code = coupon_lines[0]['code'] if coupon_lines else None

            wc_customer_id = str(wc_order.get('customer_id', ''))
            customer_uuid = None
            if wc_customer_id and wc_customer_id in customer_map:
                customer_uuid = customer_map[wc_customer_id]
            else:
                email = wc_order.get('billing', {}).get('email')
                if email:
                    cursor.execute("""
                        SELECT id FROM customers
                        WHERE store_id = %s AND email = %s
                    """, (store_id, email))
                    row = cursor.fetchone()
                    if row:
                        customer_uuid = row['id']
                        if wc_customer_id:
                            customer_map[wc_customer_id] = customer_uuid
                    else:
                        logger.debug(f"Guest order {wc_order['id']} skipped")
                        continue
                else:
                    logger.debug(f"Order {wc_order['id']} has no customer_id or email, skipping")
                    continue

            order_data = {
                'store_id': store_id,
                'customer_id': customer_uuid,
                'external_order_id': str(wc_order['id']),
                'total': float(wc_order.get('total', 0)),
                'subtotal': float(wc_order.get('subtotal', 0)),
                'discount_amount': float(wc_order.get('discount_total', 0)),
                'currency': wc_order.get('currency', 'USD'),
                'coupon_used': coupon_used,
                'coupon_code': coupon_code,
                'recovery_status': 'organic',
                'attribution_channel': None,
                'ordered_at': wc_order.get('date_created'),
                'created_at': wc_order.get('date_created'),
            }

            cursor.execute("""
                INSERT INTO orders (
                    store_id, customer_id, external_order_id, total, subtotal,
                    discount_amount, currency, coupon_used, coupon_code,
                    recovery_status, attribution_channel, ordered_at, created_at
                ) VALUES (
                    %(store_id)s, %(customer_id)s, %(external_order_id)s,
                    %(total)s, %(subtotal)s, %(discount_amount)s,
                    %(currency)s, %(coupon_used)s, %(coupon_code)s,
                    %(recovery_status)s, %(attribution_channel)s,
                    %(ordered_at)s, %(created_at)s
                )
                ON CONFLICT (store_id, external_order_id) DO UPDATE SET
                    customer_id = EXCLUDED.customer_id,
                    total = EXCLUDED.total,
                    subtotal = EXCLUDED.subtotal,
                    discount_amount = EXCLUDED.discount_amount,
                    currency = EXCLUDED.currency,
                    coupon_used = EXCLUDED.coupon_used,
                    coupon_code = EXCLUDED.coupon_code,
                    recovery_status = EXCLUDED.recovery_status,
                    attribution_channel = EXCLUDED.attribution_channel,
                    ordered_at = EXCLUDED.ordered_at
            """, order_data)

            if customer_uuid:
                cursor.execute("""
                    UPDATE customers
                    SET orders_count = orders_count + 1
                    WHERE id = %s
                """, (customer_uuid,))

        db_conn.commit()
        logger.info(f"Order sync completed: {total} orders processed for store {store_id}")

    except Exception as e:
        db_conn.rollback()
        logger.error(f"Order sync failed for store {store_id}: {str(e)}")
        raise

def sync_woo_products(store_id: str, db_conn):
    """
    Sync products, variations, categories, tags, attributes, inventory, pricing.
    """
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT shop_domain, access_token, organization_id
        FROM stores
        WHERE id = %s AND platform = 'woocommerce'
    """, (store_id,))
    store = cursor.fetchone()
    if not store:
        raise Exception(f"Store {store_id} not found")

    consumer_key, consumer_secret = decode_credentials(store['access_token'])
    shop_domain = store['shop_domain']

    logger.info(f"Starting product sync for store {store_id}")

    # Helper to safely convert to float
    def safe_float(value):
        if value is None or value == '':
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None

    # Helper to safely convert to int
    def safe_int(value):
        if value is None or value == '':
            return None
        try:
            return int(value)
        except (ValueError, TypeError):
            return 0

    try:
        products = fetch_all_pages(
            shop_domain,
            'products',
            consumer_key,
            consumer_secret,
            extra_params={'per_page': 100}
        )

        total = len(products)
        logger.info(f"Fetched {total} products from WooCommerce")

        for wc_prod in products:
            product_type = wc_prod.get('type', 'simple')
            parent_id = None
            if product_type == 'variation':
                parent_id = wc_prod.get('parent_id')

            # Extract price with empty string handling
            price = safe_float(wc_prod.get('price'))
            regular_price = safe_float(wc_prod.get('regular_price'))
            sale_price = safe_float(wc_prod.get('sale_price'))
            weight = safe_float(wc_prod.get('weight'))
            stock_quantity = safe_int(wc_prod.get('stock_quantity'))

            product_data = {
                'store_id': store_id,
                'external_id': str(wc_prod['id']),
                'parent_external_id': str(parent_id) if parent_id else None,
                'name': wc_prod.get('name', ''),
                'slug': wc_prod.get('slug', ''),
                'type': product_type,
                'status': wc_prod.get('status', 'draft'),
                'featured': wc_prod.get('featured', False),
                'catalog_visibility': wc_prod.get('catalog_visibility', 'visible'),
                'description': wc_prod.get('description', ''),
                'short_description': wc_prod.get('short_description', ''),
                'sku': wc_prod.get('sku', ''),
                'price': price,
                'regular_price': regular_price,
                'sale_price': sale_price,
                'date_on_sale_from': wc_prod.get('date_on_sale_from'),
                'date_on_sale_to': wc_prod.get('date_on_sale_to'),
                'on_sale': wc_prod.get('on_sale', False),
                'purchasable': wc_prod.get('purchasable', True),
                'total_sales': safe_int(wc_prod.get('total_sales', 0)),
                'virtual': wc_prod.get('virtual', False),
                'downloadable': wc_prod.get('downloadable', False),
                'downloads': to_json(wc_prod.get('downloads', [])),
                'download_limit': safe_int(wc_prod.get('download_limit', -1)),
                'download_expiry': safe_int(wc_prod.get('download_expiry', -1)),
                'external_url': wc_prod.get('external_url', ''),
                'button_text': wc_prod.get('button_text', ''),
                'tax_status': wc_prod.get('tax_status', 'taxable'),
                'tax_class': wc_prod.get('tax_class', ''),
                'manage_stock': wc_prod.get('manage_stock', False),
                'stock_quantity': stock_quantity,
                'stock_status': wc_prod.get('stock_status', 'instock'),
                'backorders': wc_prod.get('backorders', 'no'),
                'backorders_allowed': wc_prod.get('backorders_allowed', False),
                'backordered': wc_prod.get('backordered', False),
                'low_stock_amount': safe_int(wc_prod.get('low_stock_amount')),
                'sold_individually': wc_prod.get('sold_individually', False),
                'weight': weight,
                'dimensions': to_json(wc_prod.get('dimensions', {})),
                'shipping_required': wc_prod.get('shipping_required', True),
                'shipping_taxable': wc_prod.get('shipping_taxable', True),
                'shipping_class': wc_prod.get('shipping_class', ''),
                'shipping_class_id': safe_int(wc_prod.get('shipping_class_id', 0)),
                'reviews_allowed': wc_prod.get('reviews_allowed', True),
                'average_rating': wc_prod.get('average_rating', '0'),
                'rating_count': safe_int(wc_prod.get('rating_count', 0)),
                'related_ids': to_json(wc_prod.get('related_ids', [])),
                'upsell_ids': to_json(wc_prod.get('upsell_ids', [])),
                'cross_sell_ids': to_json(wc_prod.get('cross_sell_ids', [])),
                'parent_id': parent_id,
                'created_at': wc_prod.get('date_created'),
                'updated_at': wc_prod.get('date_modified'),
            }

            cursor.execute("""
                INSERT INTO products (
                    store_id, external_id, parent_external_id, name, slug, type, status,
                    featured, catalog_visibility, description, short_description,
                    sku, price, regular_price, sale_price, date_on_sale_from, date_on_sale_to,
                    on_sale, purchasable, total_sales, virtual, downloadable,
                    downloads, download_limit, download_expiry, external_url, button_text,
                    tax_status, tax_class, manage_stock, stock_quantity, stock_status,
                    backorders, backorders_allowed, backordered, low_stock_amount,
                    sold_individually, weight, dimensions, shipping_required, shipping_taxable,
                    shipping_class, shipping_class_id, reviews_allowed, average_rating,
                    rating_count, related_ids, upsell_ids, cross_sell_ids, parent_id,
                    created_at, updated_at
                ) VALUES (
                    %(store_id)s, %(external_id)s, %(parent_external_id)s, %(name)s, %(slug)s, %(type)s, %(status)s,
                    %(featured)s, %(catalog_visibility)s, %(description)s, %(short_description)s,
                    %(sku)s, %(price)s, %(regular_price)s, %(sale_price)s, %(date_on_sale_from)s, %(date_on_sale_to)s,
                    %(on_sale)s, %(purchasable)s, %(total_sales)s, %(virtual)s, %(downloadable)s,
                    %(downloads)s, %(download_limit)s, %(download_expiry)s, %(external_url)s, %(button_text)s,
                    %(tax_status)s, %(tax_class)s, %(manage_stock)s, %(stock_quantity)s, %(stock_status)s,
                    %(backorders)s, %(backorders_allowed)s, %(backordered)s, %(low_stock_amount)s,
                    %(sold_individually)s, %(weight)s, %(dimensions)s, %(shipping_required)s, %(shipping_taxable)s,
                    %(shipping_class)s, %(shipping_class_id)s, %(reviews_allowed)s, %(average_rating)s,
                    %(rating_count)s, %(related_ids)s, %(upsell_ids)s, %(cross_sell_ids)s, %(parent_id)s,
                    %(created_at)s, %(updated_at)s
                )
                ON CONFLICT (store_id, external_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    slug = EXCLUDED.slug,
                    status = EXCLUDED.status,
                    featured = EXCLUDED.featured,
                    catalog_visibility = EXCLUDED.catalog_visibility,
                    description = EXCLUDED.description,
                    short_description = EXCLUDED.short_description,
                    sku = EXCLUDED.sku,
                    price = EXCLUDED.price,
                    regular_price = EXCLUDED.regular_price,
                    sale_price = EXCLUDED.sale_price,
                    date_on_sale_from = EXCLUDED.date_on_sale_from,
                    date_on_sale_to = EXCLUDED.date_on_sale_to,
                    on_sale = EXCLUDED.on_sale,
                    purchasable = EXCLUDED.purchasable,
                    total_sales = EXCLUDED.total_sales,
                    virtual = EXCLUDED.virtual,
                    downloadable = EXCLUDED.downloadable,
                    downloads = EXCLUDED.downloads,
                    download_limit = EXCLUDED.download_limit,
                    download_expiry = EXCLUDED.download_expiry,
                    external_url = EXCLUDED.external_url,
                    button_text = EXCLUDED.button_text,
                    tax_status = EXCLUDED.tax_status,
                    tax_class = EXCLUDED.tax_class,
                    manage_stock = EXCLUDED.manage_stock,
                    stock_quantity = EXCLUDED.stock_quantity,
                    stock_status = EXCLUDED.stock_status,
                    backorders = EXCLUDED.backorders,
                    backorders_allowed = EXCLUDED.backorders_allowed,
                    backordered = EXCLUDED.backordered,
                    low_stock_amount = EXCLUDED.low_stock_amount,
                    sold_individually = EXCLUDED.sold_individually,
                    weight = EXCLUDED.weight,
                    dimensions = EXCLUDED.dimensions,
                    shipping_required = EXCLUDED.shipping_required,
                    shipping_taxable = EXCLUDED.shipping_taxable,
                    shipping_class = EXCLUDED.shipping_class,
                    shipping_class_id = EXCLUDED.shipping_class_id,
                    reviews_allowed = EXCLUDED.reviews_allowed,
                    average_rating = EXCLUDED.average_rating,
                    rating_count = EXCLUDED.rating_count,
                    related_ids = EXCLUDED.related_ids,
                    upsell_ids = EXCLUDED.upsell_ids,
                    cross_sell_ids = EXCLUDED.cross_sell_ids,
                    parent_id = EXCLUDED.parent_id,
                    updated_at = EXCLUDED.updated_at
            """, product_data)

            # Sync categories (many-to-many)
            categories = wc_prod.get('categories', [])
            for cat in categories:
                cursor.execute("""
                    INSERT INTO product_categories (store_id, external_id, name, slug, parent_external_id, description, display, image, menu_order, count)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (store_id, external_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        slug = EXCLUDED.slug,
                        parent_external_id = EXCLUDED.parent_external_id,
                        description = EXCLUDED.description,
                        display = EXCLUDED.display,
                        image = EXCLUDED.image,
                        menu_order = EXCLUDED.menu_order,
                        count = EXCLUDED.count
                """, (
                    store_id,
                    str(cat['id']),
                    cat['name'],
                    cat['slug'],
                    str(cat.get('parent', 0)) if cat.get('parent') else None,
                    cat.get('description', ''),
                    cat.get('display', 'default'),
                    to_json(cat.get('image', {})),
                    cat.get('menu_order', 0),
                    cat.get('count', 0)
                ))
                # Link product to category
                cursor.execute("""
                    INSERT INTO product_category_links (product_external_id, category_external_id, store_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (store_id, product_external_id, category_external_id) DO NOTHING
                """, (str(wc_prod['id']), str(cat['id']), store_id))

            # Sync tags (similar)
            tags = wc_prod.get('tags', [])
            for tag in tags:
                cursor.execute("""
                    INSERT INTO product_tags (store_id, external_id, name, slug, description, count)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (store_id, external_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        slug = EXCLUDED.slug,
                        description = EXCLUDED.description,
                        count = EXCLUDED.count
                """, (
                    store_id,
                    str(tag['id']),
                    tag['name'],
                    tag['slug'],
                    tag.get('description', ''),
                    tag.get('count', 0)
                ))
                cursor.execute("""
                    INSERT INTO product_tag_links (product_external_id, tag_external_id, store_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (store_id, product_external_id, tag_external_id) DO NOTHING
                """, (str(wc_prod['id']), str(tag['id']), store_id))

            # Sync images
            images = wc_prod.get('images', [])
            for img in images:
                cursor.execute("""
                    INSERT INTO product_images (store_id, product_external_id, external_id, src, name, alt, position)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (store_id, product_external_id, external_id) DO UPDATE SET
                        src = EXCLUDED.src,
                        name = EXCLUDED.name,
                        alt = EXCLUDED.alt,
                        position = EXCLUDED.position
                """, (
                    store_id,
                    str(wc_prod['id']),
                    str(img['id']),
                    img['src'],
                    img.get('name', ''),
                    img.get('alt', ''),
                    img.get('position', 0)
                ))

            # Sync attributes
            attributes = wc_prod.get('attributes', [])
            for attr in attributes:
                cursor.execute("""
                    INSERT INTO product_attributes (store_id, product_external_id, external_id, name, position, visible, variation, options)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (store_id, product_external_id, external_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        position = EXCLUDED.position,
                        visible = EXCLUDED.visible,
                        variation = EXCLUDED.variation,
                        options = EXCLUDED.options
                """, (
                    store_id,
                    str(wc_prod['id']),
                    str(attr['id']),
                    attr['name'],
                    attr.get('position', 0),
                    attr.get('visible', True),
                    attr.get('variation', False),
                    to_json(attr.get('options', []))
                ))

        db_conn.commit()
        logger.info(f"Product sync completed: {total} products upserted for store {store_id}")

    except Exception as e:
        db_conn.rollback()
        logger.error(f"Product sync failed for store {store_id}: {str(e)}")
        raise


def sync_woo_coupons(store_id: str, db_conn):
    """Sync all coupons and discounts."""
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT shop_domain, access_token, organization_id
        FROM stores
        WHERE id = %s AND platform = 'woocommerce'
    """, (store_id,))
    store = cursor.fetchone()
    if not store:
        raise Exception(f"Store {store_id} not found")

    consumer_key, consumer_secret = decode_credentials(store['access_token'])
    shop_domain = store['shop_domain']

    logger.info(f"Starting coupon sync for store {store_id}")

    try:
        coupons = fetch_all_pages(
            shop_domain,
            'coupons',
            consumer_key,
            consumer_secret
        )

        total = len(coupons)
        logger.info(f"Fetched {total} coupons from WooCommerce")

        for wc_coupon in coupons:
            coupon_data = {
                'store_id': store_id,
                'external_id': str(wc_coupon['id']),
                'code': wc_coupon.get('code', ''),
                'type': wc_coupon.get('discount_type', 'fixed_cart'),
                'amount': float(wc_coupon.get('amount', 0)),
                'date_created': wc_coupon.get('date_created'),
                'date_modified': wc_coupon.get('date_modified'),
                'date_expires': wc_coupon.get('date_expires'),
                'usage_count': wc_coupon.get('usage_count', 0),
                'individual_use': wc_coupon.get('individual_use', False),
                'product_ids': to_json(wc_coupon.get('product_ids', [])),
                'excluded_product_ids': to_json(wc_coupon.get('excluded_product_ids', [])),
                'usage_limit': wc_coupon.get('usage_limit'),
                'usage_limit_per_user': wc_coupon.get('usage_limit_per_user'),
                'limit_usage_to_x_items': wc_coupon.get('limit_usage_to_x_items'),
                'free_shipping': wc_coupon.get('free_shipping', False),
                'product_categories': to_json(wc_coupon.get('product_categories', [])),
                'excluded_product_categories': to_json(wc_coupon.get('excluded_product_categories', [])),
                'exclude_sale_items': wc_coupon.get('exclude_sale_items', False),
                'minimum_amount': float(wc_coupon.get('minimum_amount', 0)) if wc_coupon.get('minimum_amount') else None,
                'maximum_amount': float(wc_coupon.get('maximum_amount', 0)) if wc_coupon.get('maximum_amount') else None,
                'email_restrictions': to_json(wc_coupon.get('email_restrictions', [])),
                'used_by': to_json(wc_coupon.get('used_by', [])),
                'created_at': wc_coupon.get('date_created'),
                'updated_at': wc_coupon.get('date_modified'),
            }

            cursor.execute("""
                INSERT INTO coupons (
                    store_id, external_id, code, type, amount,
                    date_created, date_modified, date_expires, usage_count,
                    individual_use, product_ids, excluded_product_ids,
                    usage_limit, usage_limit_per_user, limit_usage_to_x_items,
                    free_shipping, product_categories, excluded_product_categories,
                    exclude_sale_items, minimum_amount, maximum_amount,
                    email_restrictions, used_by, created_at, updated_at
                ) VALUES (
                    %(store_id)s, %(external_id)s, %(code)s, %(type)s, %(amount)s,
                    %(date_created)s, %(date_modified)s, %(date_expires)s, %(usage_count)s,
                    %(individual_use)s, %(product_ids)s, %(excluded_product_ids)s,
                    %(usage_limit)s, %(usage_limit_per_user)s, %(limit_usage_to_x_items)s,
                    %(free_shipping)s, %(product_categories)s, %(excluded_product_categories)s,
                    %(exclude_sale_items)s, %(minimum_amount)s, %(maximum_amount)s,
                    %(email_restrictions)s, %(used_by)s, %(created_at)s, %(updated_at)s
                )
                ON CONFLICT (store_id, external_id) DO UPDATE SET
                    code = EXCLUDED.code,
                    type = EXCLUDED.type,
                    amount = EXCLUDED.amount,
                    date_modified = EXCLUDED.date_modified,
                    date_expires = EXCLUDED.date_expires,
                    usage_count = EXCLUDED.usage_count,
                    individual_use = EXCLUDED.individual_use,
                    product_ids = EXCLUDED.product_ids,
                    excluded_product_ids = EXCLUDED.excluded_product_ids,
                    usage_limit = EXCLUDED.usage_limit,
                    usage_limit_per_user = EXCLUDED.usage_limit_per_user,
                    limit_usage_to_x_items = EXCLUDED.limit_usage_to_x_items,
                    free_shipping = EXCLUDED.free_shipping,
                    product_categories = EXCLUDED.product_categories,
                    excluded_product_categories = EXCLUDED.excluded_product_categories,
                    exclude_sale_items = EXCLUDED.exclude_sale_items,
                    minimum_amount = EXCLUDED.minimum_amount,
                    maximum_amount = EXCLUDED.maximum_amount,
                    email_restrictions = EXCLUDED.email_restrictions,
                    used_by = EXCLUDED.used_by,
                    updated_at = EXCLUDED.updated_at
            """, coupon_data)

        db_conn.commit()
        logger.info(f"Coupon sync completed: {total} coupons upserted for store {store_id}")

    except Exception as e:
        db_conn.rollback()
        logger.error(f"Coupon sync failed for store {store_id}: {str(e)}")
        raise


def sync_woo_settings(store_id: str, db_conn):
    """Sync store settings (general, tax, shipping, payment gateways)."""
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT shop_domain, access_token, organization_id
        FROM stores
        WHERE id = %s AND platform = 'woocommerce'
    """, (store_id,))
    store = cursor.fetchone()
    if not store:
        raise Exception(f"Store {store_id} not found")

    consumer_key, consumer_secret = decode_credentials(store['access_token'])
    shop_domain = store['shop_domain']

    logger.info(f"Starting store settings sync for store {store_id}")

    try:
        # General settings
        settings_general = make_woo_request_with_headers(
            shop_domain, 'settings/general', consumer_key, consumer_secret
        ).json()
        cursor.execute("""
            INSERT INTO store_settings (store_id, settings_group, settings)
            VALUES (%s, 'general', %s)
            ON CONFLICT (store_id, settings_group) DO UPDATE SET
                settings = EXCLUDED.settings,
                updated_at = NOW()
        """, (store_id, to_json(settings_general)))

        # Tax settings
        settings_tax = make_woo_request_with_headers(
            shop_domain, 'settings/tax', consumer_key, consumer_secret
        ).json()
        cursor.execute("""
            INSERT INTO store_settings (store_id, settings_group, settings)
            VALUES (%s, 'tax', %s)
            ON CONFLICT (store_id, settings_group) DO UPDATE SET
                settings = EXCLUDED.settings,
                updated_at = NOW()
        """, (store_id, to_json(settings_tax)))

        # Shipping zones
        shipping_zones = make_woo_request_with_headers(
            shop_domain, 'shipping/zones', consumer_key, consumer_secret
        ).json()
        cursor.execute("""
            INSERT INTO store_settings (store_id, settings_group, settings)
            VALUES (%s, 'shipping', %s)
            ON CONFLICT (store_id, settings_group) DO UPDATE SET
                settings = EXCLUDED.settings,
                updated_at = NOW()
        """, (store_id, to_json(shipping_zones)))

        # Payment gateways
        payment_gateways = make_woo_request_with_headers(
            shop_domain, 'payment_gateways', consumer_key, consumer_secret
        ).json()
        cursor.execute("""
            INSERT INTO store_settings (store_id, settings_group, settings)
            VALUES (%s, 'payment_gateways', %s)
            ON CONFLICT (store_id, settings_group) DO UPDATE SET
                settings = EXCLUDED.settings,
                updated_at = NOW()
        """, (store_id, to_json(payment_gateways)))

        db_conn.commit()
        logger.info(f"Store settings sync completed for store {store_id}")

    except Exception as e:
        db_conn.rollback()
        logger.error(f"Store settings sync failed for store {store_id}: {str(e)}")
        raise


def sync_woocommerce_store(store_id: str):
    """
    Master sync function – runs all required syncs in order.
    """
    db_conn = None
    try:
        db_conn = get_db_connection()
        cursor = db_conn.cursor()

        # Verify store exists
        cursor.execute("""
            SELECT id FROM stores
            WHERE id = %s AND platform = 'woocommerce'
        """, (store_id,))
        if not cursor.fetchone():
            logger.error(f"Store {store_id} not found or not WooCommerce")
            return

        # Update status to 'syncing'
        cursor.execute("""
            UPDATE stores
            SET status = 'syncing', updated_at = NOW()
            WHERE id = %s
        """, (store_id,))
        db_conn.commit()
        logger.info(f"Store {store_id} status set to 'syncing'")

        # === RUN ALL SYNC FUNCTIONS ===
        sync_woo_customers(store_id, db_conn)
        sync_woo_orders(store_id, db_conn)
        sync_woo_products(store_id, db_conn)
        sync_woo_coupons(store_id, db_conn)
        sync_woo_settings(store_id, db_conn)

        # Update status to 'active'
        cursor.execute("""
            UPDATE stores
            SET status = 'active', last_synced_at = NOW(), updated_at = NOW()
            WHERE id = %s
        """, (store_id,))
        db_conn.commit()

        logger.info(f"Store {store_id} synchronization completed successfully")

    except Exception as e:
        logger.error(f"Synchronization failed for store {store_id}: {str(e)}")
        if db_conn:
            try:
                cursor = db_conn.cursor()
                cursor.execute("""
                    UPDATE stores
                    SET status = 'error', updated_at = NOW()
                    WHERE id = %s
                """, (store_id,))
                db_conn.commit()
                logger.info(f"Store {store_id} status set to 'error'")
            except Exception as db_e:
                logger.error(f"Could not update store status: {db_e}")
        raise
    finally:
        if db_conn:
            db_conn.close()
            logger.debug("Database connection closed")


def main():
    parser = argparse.ArgumentParser(description='Synchronize WooCommerce store data.')
    parser.add_argument('store_id', type=str, help='UUID of the store to synchronize')
    args = parser.parse_args()

    if not args.store_id:
        print("Usage: python woocommerce_sync.py <store_id>")
        sys.exit(1)

    try:
        sync_woocommerce_store(args.store_id)
    except Exception as e:
        logger.error(f"Unhandled exception: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()