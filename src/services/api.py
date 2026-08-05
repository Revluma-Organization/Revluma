import os
import sys
import json
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional, Dict, Any
from datetime import datetime
import importlib.metadata
import dotenv

from fastapi import FastAPI, HTTPException, Request, Path
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field, validator
import uvicorn

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load environment
dotenv.load_dotenv(dotenv.find_dotenv())

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('woocommerce_api')
webhook_logger = logging.getLogger('woocommerce_webhook')

# Create FastAPI app
app = FastAPI(
    title="Synchronization Service",
    description="Internal API for triggering e-commerce platform synchronization and handling webhooks",
    version="1.0.0"
)

# Thread pool for background tasks
executor = ThreadPoolExecutor(max_workers=4)

# ============================================================================
# Request Models (for internal sync trigger)
# ============================================================================

class SyncTriggerRequest(BaseModel):
    """Request model for triggering synchronization."""
    store_id: str = Field(..., description="UUID of the store to synchronize")
    platform: str = Field(..., description="Platform name (woocommerce, shopify, etc.)")

    @validator('platform')
    def validate_platform(cls, v):
        """Validate that the platform is supported."""
        supported = ['woocommerce', 'shopify']
        if v not in supported:
            raise ValueError(f"Unsupported platform: {v}. Supported: {', '.join(supported)}")
        return v

# ============================================================================
# Internal Sync Endpoint
# ============================================================================

@app.post("/internal/sync/trigger")
async def trigger_sync(request: SyncTriggerRequest):
    """
    Internal endpoint to trigger background synchronization.
    This endpoint is only accessible from trusted internal networks.
    """
    logger.info(f"Received sync trigger request: store_id={request.store_id}, platform={request.platform}")

    try:
        # Import sync service based on platform
        if request.platform == 'woocommerce':
            from src.services.woocommerce_sync import sync_woocommerce_store

            loop = asyncio.get_event_loop()

            def run_sync():
                try:
                    logger.info(f"Starting WooCommerce sync for store {request.store_id}")
                    sync_woocommerce_store(request.store_id)
                    logger.info(f"WooCommerce sync completed for store {request.store_id}")
                except Exception as e:
                    logger.error(f"WooCommerce sync failed for store {request.store_id}: {str(e)}")
                    raise

            await loop.run_in_executor(executor, run_sync)

            return {
                "status": "success",
                "message": f"WooCommerce synchronization triggered for store {request.store_id}",
                "store_id": request.store_id,
                "platform": request.platform,
                "queued_at": datetime.now().isoformat()
            }

        elif request.platform == 'shopify':
            # Placeholder for future Shopify sync
            return {
                "status": "error",
                "message": "Shopify synchronization is not yet implemented",
                "platform": request.platform
            }
        else:
            return {
                "status": "error",
                "message": f"Unsupported platform: {request.platform}",
                "platform": request.platform
            }

    except ImportError as e:
        logger.error(f"Failed to import sync module for {request.platform}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Synchronization service for {request.platform} is not available"
        )
    except Exception as e:
        logger.error(f"Error triggering sync: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to trigger synchronization: {str(e)}"
        )

# ============================================================================
# Health Check Endpoint
# ============================================================================

class HealthResponse(BaseModel):
    """Health check response model."""
    status: str
    service_name: str
    service_version: str
    timestamp: str
    database_configured: bool
    database_url: Optional[str] = None  # Only show first few chars for security
    loaded_models: List[str] = []
    active_platforms: List[str] = []

@app.get("/health")
async def health_check():
    """Enhanced health check endpoint with runtime diagnostics."""
    try:
        version = importlib.metadata.version('fastapi')
    except:
        version = "unknown"

    db_url = os.getenv('DATABASE_URL')
    db_configured = bool(db_url)

    masked_db_url = None
    if db_configured and db_url:
        if '://' in db_url:
            protocol, rest = db_url.split('://', 1)
            if '@' in rest:
                masked_db_url = f"{protocol}://****:****@{rest.split('@')[1][:20]}..."
            else:
                masked_db_url = f"{protocol}://{rest[:20]}..."
        else:
            masked_db_url = db_url[:20] + "..."

    loaded_models = []
    active_platforms = ['woocommerce']

    return HealthResponse(
        status="healthy",
        service_name="Synchronization Service",
        service_version=app.version,
        timestamp=datetime.now().isoformat(),
        database_configured=db_configured,
        database_url=masked_db_url,
        loaded_models=loaded_models,
        active_platforms=active_platforms
    )

# ============================================================================
# Webhook Receiver Endpoint
# ============================================================================

@app.post("/api/webhooks/woocommerce/{store_id}")
async def woocommerce_webhook(
    request: Request,
    store_id: str = Path(..., description="Store UUID")
):
    """
    Receive WooCommerce webhook events.
    Process and upsert the relevant data into the database.
    """
    try:
        headers = request.headers
        topic = headers.get('x-wc-webhook-topic')
        if not topic:
            webhook_logger.warning("Missing x-wc-webhook-topic header")
            raise HTTPException(status_code=400, detail="Missing webhook topic")

        payload = await request.json()
        webhook_logger.info(f"Received webhook: {topic} for store {store_id}")

        db_conn = None
        try:
            from src.services.woocommerce_sync import get_db_connection
            db_conn = get_db_connection()
            cursor = db_conn.cursor()

            # Verify store exists
            cursor.execute("""
                SELECT shop_domain, access_token, organization_id
                FROM stores
                WHERE id = %s AND platform = 'woocommerce'
            """, (store_id,))
            store = cursor.fetchone()
            if not store:
                webhook_logger.error(f"Store {store_id} not found")
                raise HTTPException(status_code=404, detail="Store not found")

            # Process based on topic
            if topic in ('order.created', 'order.updated'):
                await _process_order_webhook(store_id, payload, db_conn)
            elif topic in ('customer.created', 'customer.updated'):
                await _process_customer_webhook(store_id, payload, db_conn)
            elif topic in ('product.created', 'product.updated'):
                await _process_product_webhook(store_id, payload, db_conn)
            elif topic in ('coupon.created', 'coupon.updated'):
                await _process_coupon_webhook(store_id, payload, db_conn)
            elif topic == 'refund.created':
                await _process_refund_webhook(store_id, payload, db_conn)
            elif topic == 'inventory.updated':
                await _process_inventory_webhook(store_id, payload, db_conn)
            else:
                webhook_logger.info(f"Unhandled webhook topic: {topic}")
                # Still return 200 to avoid retries

            db_conn.commit()
            webhook_logger.info(f"Webhook {topic} processed for store {store_id}")

        except Exception as e:
            webhook_logger.error(f"Error processing webhook {topic} for store {store_id}: {str(e)}")
            if db_conn:
                db_conn.rollback()
            raise HTTPException(status_code=500, detail="Internal server error")
        finally:
            if db_conn:
                db_conn.close()

        return {"status": "success", "topic": topic}

    except json.JSONDecodeError:
        webhook_logger.error("Invalid JSON payload")
        raise HTTPException(status_code=400, detail="Invalid JSON")
    except Exception as e:
        webhook_logger.error(f"Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


# -----------------------------------------------------------------------------
# Webhook processors (private helpers)
# -----------------------------------------------------------------------------

async def _process_order_webhook(store_id: str, payload: dict, db_conn):
    """Process order webhook (created/updated)."""
    from psycopg2.extras import RealDictCursor
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)

    # Get existing customers mapping
    cursor.execute("""
        SELECT id, external_id FROM customers WHERE store_id = %s
    """, (store_id,))
    customer_map = {row['external_id']: row['id'] for row in cursor.fetchall()}

    wc_order = payload
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
        # if still None, it's a guest order – skip customer linking

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
    webhook_logger.info(f"Order {wc_order['id']} synced for store {store_id}")


async def _process_customer_webhook(store_id: str, payload: dict, db_conn):
    """Process customer webhook (created/updated)."""
    from psycopg2.extras import RealDictCursor
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)
    wc_cust = payload

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
    webhook_logger.info(f"Customer {wc_cust['id']} synced for store {store_id}")


async def _process_product_webhook(store_id: str, payload: dict, db_conn):
    """Process product webhook (created/updated)."""
    from psycopg2.extras import RealDictCursor
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)
    wc_prod = payload

    # We'll upsert a subset of fields; the full sync will fill other columns later.
    product_data = {
        'store_id': store_id,
        'external_id': str(wc_prod['id']),
        'name': wc_prod.get('name', ''),
        'type': wc_prod.get('type', 'simple'),
        'status': wc_prod.get('status', 'draft'),
        'sku': wc_prod.get('sku', ''),
        'price': float(wc_prod.get('price', 0)),
        'regular_price': float(wc_prod.get('regular_price', 0)) if wc_prod.get('regular_price') else None,
        'sale_price': float(wc_prod.get('sale_price', 0)) if wc_prod.get('sale_price') else None,
        'stock_quantity': wc_prod.get('stock_quantity'),
        'stock_status': wc_prod.get('stock_status', 'instock'),
        'manage_stock': wc_prod.get('manage_stock', False),
        'updated_at': wc_prod.get('date_modified'),
    }

    cursor.execute("""
        INSERT INTO products (
            store_id, external_id, name, type, status, sku,
            price, regular_price, sale_price,
            stock_quantity, stock_status, manage_stock,
            updated_at
        ) VALUES (
            %(store_id)s, %(external_id)s, %(name)s, %(type)s, %(status)s, %(sku)s,
            %(price)s, %(regular_price)s, %(sale_price)s,
            %(stock_quantity)s, %(stock_status)s, %(manage_stock)s,
            %(updated_at)s
        )
        ON CONFLICT (store_id, external_id) DO UPDATE SET
            name = EXCLUDED.name,
            type = EXCLUDED.type,
            status = EXCLUDED.status,
            sku = EXCLUDED.sku,
            price = EXCLUDED.price,
            regular_price = EXCLUDED.regular_price,
            sale_price = EXCLUDED.sale_price,
            stock_quantity = EXCLUDED.stock_quantity,
            stock_status = EXCLUDED.stock_status,
            manage_stock = EXCLUDED.manage_stock,
            updated_at = EXCLUDED.updated_at
    """, product_data)

    db_conn.commit()
    webhook_logger.info(f"Product {wc_prod['id']} synced for store {store_id}")


async def _process_coupon_webhook(store_id: str, payload: dict, db_conn):
    """Process coupon webhook (created/updated)."""
    from psycopg2.extras import RealDictCursor
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)
    wc_coupon = payload

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
    }

    cursor.execute("""
        INSERT INTO coupons (
            store_id, external_id, code, type, amount,
            date_created, date_modified, date_expires, usage_count
        ) VALUES (
            %(store_id)s, %(external_id)s, %(code)s, %(type)s, %(amount)s,
            %(date_created)s, %(date_modified)s, %(date_expires)s, %(usage_count)s
        )
        ON CONFLICT (store_id, external_id) DO UPDATE SET
            code = EXCLUDED.code,
            type = EXCLUDED.type,
            amount = EXCLUDED.amount,
            date_modified = EXCLUDED.date_modified,
            date_expires = EXCLUDED.date_expires,
            usage_count = EXCLUDED.usage_count
    """, coupon_data)

    db_conn.commit()
    webhook_logger.info(f"Coupon {wc_coupon['id']} synced for store {store_id}")


async def _process_refund_webhook(store_id: str, payload: dict, db_conn):
    """Process refund webhook."""
    from psycopg2.extras import RealDictCursor
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)

    order_id = payload.get('order_id')
    if not order_id:
        webhook_logger.warning("Refund webhook missing order_id")
        return

    total_refunded = float(payload.get('total', 0))
    cursor.execute("""
        UPDATE orders
        SET status = 'refunded',
            total_refunded = COALESCE(total_refunded, 0) + %s,
            updated_at = NOW()
        WHERE store_id = %s AND external_order_id = %s
    """, (total_refunded, store_id, str(order_id)))

    db_conn.commit()
    webhook_logger.info(f"Refund processed for order {order_id} for store {store_id}")


async def _process_inventory_webhook(store_id: str, payload: dict, db_conn):
    """Process inventory update webhook."""
    from psycopg2.extras import RealDictCursor
    cursor = db_conn.cursor(cursor_factory=RealDictCursor)

    product_id = payload.get('product_id')
    if not product_id:
        webhook_logger.warning("Inventory webhook missing product_id")
        return

    stock_quantity = payload.get('stock_quantity')
    stock_status = payload.get('stock_status')

    cursor.execute("""
        UPDATE products
        SET stock_quantity = COALESCE(%s, stock_quantity),
            stock_status = COALESCE(%s, stock_status),
            updated_at = NOW()
        WHERE store_id = %s AND external_id = %s
    """, (stock_quantity, stock_status, store_id, str(product_id)))

    db_conn.commit()
    webhook_logger.info(f"Inventory updated for product {product_id} for store {store_id}")


# ============================================================================
# IP Allow-List Middleware (Production)
# ============================================================================

class IPAllowListMiddleware:
    """Middleware to restrict access to internal endpoints."""
    def __init__(
        self,
        app,
        allowed_ips: List[str] = None,
        allowed_cidrs: List[str] = None
    ):
        self.app = app
        self.allowed_ips = allowed_ips or ['127.0.0.1', '::1', 'localhost']
        self.allowed_cidrs = allowed_cidrs or []

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        client_ip = scope.get('client', ('', 0))[0]
        path = scope.get('path', '')
        if path.startswith('/internal/'):
            if not self._is_allowed(client_ip):
                response = HTTPException(
                    status_code=403,
                    detail="Access denied: internal endpoint restricted"
                )
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)

    def _is_allowed(self, ip: str) -> bool:
        if ip in self.allowed_ips:
            return True
        if ip == '127.0.0.1' and 'localhost' in self.allowed_ips:
            return True
        if ip == '::1' and 'localhost' in self.allowed_ips:
            return True
        return False

# Enable IP allow-list in production
if os.getenv('ENV') == 'production':
    app.add_middleware(
        IPAllowListMiddleware,
        allowed_ips=['127.0.0.1', '::1', 'localhost']
    )
    logger.info("IP allow-list middleware enabled for production")
else:
    logger.info("Running in development mode - IP restrictions disabled")

# ============================================================================
# Startup/Shutdown Events
# ============================================================================

@app.on_event("startup")
async def startup_event():
    logger.info("Synchronization service starting up...")
    logger.info(f"Database configured: {bool(os.getenv('DATABASE_URL'))}")
    try:
        import src.services.woocommerce_sync
        logger.info("WooCommerce sync service loaded successfully")
    except ImportError as e:
        logger.warning(f"WooCommerce sync service not available: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Synchronization service shutting down...")
    executor.shutdown(wait=True)
    logger.info("Thread pool executor shut down")

# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    port = int(os.getenv('PORT', 8000))
    host = os.getenv('HOST', '0.0.0.0')
    uvicorn.run(
        "api:app",
        host=host,
        port=port,
        reload=os.getenv('ENV') != 'production',
        log_level="info"
    )