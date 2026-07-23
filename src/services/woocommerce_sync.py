import os
import sys
import logging
import argparse
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
    For local development (localhost, .local, etc.), SSL verification is disabled.
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


def sync_woocommerce_store(store_id: str):
    db_conn = None
    try:
        db_conn = get_db_connection()
        cursor = db_conn.cursor()

        cursor.execute("""
            SELECT id FROM stores
            WHERE id = %s AND platform = 'woocommerce'
        """, (store_id,))
        if not cursor.fetchone():
            logger.error(f"Store {store_id} not found or not WooCommerce")
            return

        cursor.execute("""
            UPDATE stores
            SET status = 'syncing', updated_at = NOW()
            WHERE id = %s
        """, (store_id,))
        db_conn.commit()
        logger.info(f"Store {store_id} status set to 'syncing'")

        sync_woo_customers(store_id, db_conn)
        sync_woo_orders(store_id, db_conn)

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