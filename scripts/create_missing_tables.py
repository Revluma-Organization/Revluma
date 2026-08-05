import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()

# Connect to the database
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()

# Enable UUID extension if not already enabled
cur.execute("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";")

print("📦 Creating missing WooCommerce sync tables...")

# ============================================================
# 1. PRODUCTS TABLE
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        external_id VARCHAR(255) NOT NULL,
        parent_external_id VARCHAR(255),
        name VARCHAR(500) NOT NULL DEFAULT '',
        slug VARCHAR(255) DEFAULT '',
        type VARCHAR(50) DEFAULT 'simple',
        status VARCHAR(50) DEFAULT 'draft',
        featured BOOLEAN DEFAULT FALSE,
        catalog_visibility VARCHAR(50) DEFAULT 'visible',
        description TEXT DEFAULT '',
        short_description TEXT DEFAULT '',
        sku VARCHAR(255) DEFAULT '',
        price DECIMAL(10,2) DEFAULT 0,
        regular_price DECIMAL(10,2),
        sale_price DECIMAL(10,2),
        date_on_sale_from TIMESTAMP,
        date_on_sale_to TIMESTAMP,
        on_sale BOOLEAN DEFAULT FALSE,
        purchasable BOOLEAN DEFAULT TRUE,
        total_sales INTEGER DEFAULT 0,
        virtual BOOLEAN DEFAULT FALSE,
        downloadable BOOLEAN DEFAULT FALSE,
        downloads JSONB DEFAULT '[]',
        download_limit INTEGER DEFAULT -1,
        download_expiry INTEGER DEFAULT -1,
        external_url VARCHAR(500) DEFAULT '',
        button_text VARCHAR(255) DEFAULT '',
        tax_status VARCHAR(50) DEFAULT 'taxable',
        tax_class VARCHAR(50) DEFAULT '',
        manage_stock BOOLEAN DEFAULT FALSE,
        stock_quantity INTEGER,
        stock_status VARCHAR(50) DEFAULT 'instock',
        backorders VARCHAR(50) DEFAULT 'no',
        backorders_allowed BOOLEAN DEFAULT FALSE,
        backordered BOOLEAN DEFAULT FALSE,
        low_stock_amount INTEGER,
        sold_individually BOOLEAN DEFAULT FALSE,
        weight DECIMAL(10,2),
        dimensions JSONB,
        shipping_required BOOLEAN DEFAULT TRUE,
        shipping_taxable BOOLEAN DEFAULT TRUE,
        shipping_class VARCHAR(50) DEFAULT '',
        shipping_class_id INTEGER DEFAULT 0,
        reviews_allowed BOOLEAN DEFAULT TRUE,
        average_rating VARCHAR(10) DEFAULT '0',
        rating_count INTEGER DEFAULT 0,
        related_ids JSONB DEFAULT '[]',
        upsell_ids JSONB DEFAULT '[]',
        cross_sell_ids JSONB DEFAULT '[]',
        parent_id INTEGER,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        created_at_auto TIMESTAMP DEFAULT NOW(),
        updated_at_auto TIMESTAMP DEFAULT NOW(),
        UNIQUE(store_id, external_id)
    );
""")
print("✅ products table created")

# ============================================================
# 2. PRODUCT CATEGORIES TABLE
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS product_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        external_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) DEFAULT '',
        parent_external_id VARCHAR(255),
        description TEXT DEFAULT '',
        display VARCHAR(50) DEFAULT 'default',
        image JSONB,
        menu_order INTEGER DEFAULT 0,
        count INTEGER DEFAULT 0,
        UNIQUE(store_id, external_id)
    );
""")
print("✅ product_categories table created")

# ============================================================
# 3. PRODUCT CATEGORY LINKS TABLE
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS product_category_links (
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        product_external_id VARCHAR(255) NOT NULL,
        category_external_id VARCHAR(255) NOT NULL,
        PRIMARY KEY (store_id, product_external_id, category_external_id)
    );
""")
print("✅ product_category_links table created")

# ============================================================
# 4. PRODUCT TAGS TABLE
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS product_tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        external_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) DEFAULT '',
        description TEXT DEFAULT '',
        count INTEGER DEFAULT 0,
        UNIQUE(store_id, external_id)
    );
""")
print("✅ product_tags table created")

# ============================================================
# 5. PRODUCT TAG LINKS TABLE
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS product_tag_links (
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        product_external_id VARCHAR(255) NOT NULL,
        tag_external_id VARCHAR(255) NOT NULL,
        PRIMARY KEY (store_id, product_external_id, tag_external_id)
    );
""")
print("✅ product_tag_links table created")

# ============================================================
# 6. PRODUCT IMAGES TABLE
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS product_images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        product_external_id VARCHAR(255) NOT NULL,
        external_id VARCHAR(255) NOT NULL,
        src VARCHAR(1000) NOT NULL,
        name VARCHAR(255) DEFAULT '',
        alt VARCHAR(255) DEFAULT '',
        position INTEGER DEFAULT 0,
        UNIQUE(store_id, product_external_id, external_id)
    );
""")
print("✅ product_images table created")

# ============================================================
# 7. PRODUCT ATTRIBUTES TABLE
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS product_attributes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        product_external_id VARCHAR(255) NOT NULL,
        external_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        position INTEGER DEFAULT 0,
        visible BOOLEAN DEFAULT TRUE,
        variation BOOLEAN DEFAULT FALSE,
        options JSONB DEFAULT '[]',
        UNIQUE(store_id, product_external_id, external_id)
    );
""")
print("✅ product_attributes table created")

# ============================================================
# 8. COUPONS TABLE
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS coupons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        external_id VARCHAR(255) NOT NULL,
        code VARCHAR(255) NOT NULL,
        type VARCHAR(50) DEFAULT 'fixed_cart',
        amount DECIMAL(10,2) DEFAULT 0,
        date_created TIMESTAMP,
        date_modified TIMESTAMP,
        date_expires TIMESTAMP,
        usage_count INTEGER DEFAULT 0,
        individual_use BOOLEAN DEFAULT FALSE,
        product_ids JSONB DEFAULT '[]',
        excluded_product_ids JSONB DEFAULT '[]',
        usage_limit INTEGER,
        usage_limit_per_user INTEGER,
        limit_usage_to_x_items INTEGER,
        free_shipping BOOLEAN DEFAULT FALSE,
        product_categories JSONB DEFAULT '[]',
        excluded_product_categories JSONB DEFAULT '[]',
        exclude_sale_items BOOLEAN DEFAULT FALSE,
        minimum_amount DECIMAL(10,2),
        maximum_amount DECIMAL(10,2),
        email_restrictions JSONB DEFAULT '[]',
        used_by JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(store_id, external_id)
    );
""")
print("✅ coupons table created")

# ============================================================
# 9. STORE SETTINGS TABLE
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS store_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        settings_group VARCHAR(50) NOT NULL,
        settings JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(store_id, settings_group)
    );
""")
print("✅ store_settings table created")

# ============================================================
# 10. WEBHOOK REGISTRATIONS TABLE (Optional – for tracking)
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS webhook_registrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        external_id VARCHAR(255) NOT NULL,
        topic VARCHAR(100) NOT NULL,
        delivery_url VARCHAR(1000) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(store_id, external_id)
    );
""")
print("✅ webhook_registrations table created")

# ============================================================
# Commit all changes and close connection
# ============================================================
conn.commit()
print("\n✅ All tables created successfully!")

cur.close()
conn.close()