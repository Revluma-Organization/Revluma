// ============================================================
// PLATFORM ADAPTER TYPES & INTERFACES
// ============================================================
// Type definitions for the unified e-commerce adapter pattern
// All platforms (Shopify, WooCommerce, BigCommerce) conform to this contract

export type Platform = 'shopify' | 'woocommerce' | 'bigcommerce';

// ============================================================
// CORE IDENTITY TYPES
// ============================================================

export type PlatformRef = {
  platform: Platform;
  storeId: string;
  externalId: string;
};

export type PlatformCredentials = {
  platform: Platform;
  // Shopify
  shopDomain?: string;
  accessToken?: string;
  // WooCommerce
  storeUrl?: string;
  consumerKey?: string;
  consumerSecret?: string;
  // BigCommerce
  storeHash?: string;
  accessToken?: string;
  clientId?: string;
};

export type ConnectionResult = {
  success: boolean;
  storeId?: string;
  storeName?: string;
  error?: string;
};

export type HealthStatus = {
  healthy: boolean;
  latencyMs: number;
  error?: string;
};

// ============================================================
// FETCH PARAMS & PAGINATION
// ============================================================

export type FetchParams = {
  since?: Date;
  until?: Date;
  limit?: number;
  cursor?: string;
  status?: string;
};

export type SyncCursor = {
  cursor: string;
  timestamp: Date;
  processedCount: number;
};

// ============================================================
// WEBHOOK TYPES
// ============================================================

export type WebhookTopic = 
  | 'orders/create'
  | 'orders/update'
  | 'orders/delete'
  | 'customers/create'
  | 'customers/update'
  | 'checkouts/create'
  | 'checkouts/update'
  | 'carts/create'
  | 'carts/update'
  | 'carts/abandoned';

export type WebhookRegistration = {
  topic: WebhookTopic;
  callbackUrl: string;
  webhookId?: string;
  registeredAt?: Date;
};

// ============================================================
// NORMALIZED INTERNAL EVENTS
// ============================================================

export type InternalEvent =
  | CheckoutAbandonedEvent
  | OrderCreatedEvent
  | OrderUpdatedEvent
  | CustomerCreatedEvent
  | CustomerUpdatedEvent;

export type CheckoutAbandonedEvent = {
  type: 'checkout.abandoned';
  checkout: Checkout;
};

export type OrderCreatedEvent = {
  type: 'order.created';
  order: Order;
};

export type OrderUpdatedEvent = {
  type: 'order.updated';
  order: Order;
};

export type CustomerCreatedEvent = {
  type: 'customer.created';
  customer: Customer;
};

export type CustomerUpdatedEvent = {
  type: 'customer.updated';
  customer: Customer;
};

// ============================================================
// NORMALIZED DATA TYPES
// ============================================================

export type Customer = {
  id: string;
  ref: PlatformRef;
  email: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  totalSpent: number;
  currency: string;
  ordersCount: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type OrderStatus = 
  | 'pending' 
  | 'processing' 
  | 'completed' 
  | 'cancelled' 
  | 'refunded' 
  | 'failed';

export type Order = {
  id: string;
  ref: PlatformRef;
  customerId: string | null;
  email: string;
  status: OrderStatus;
  totalPrice: number;
  subtotalPrice: number;
  totalTax: number;
  totalDiscounts: number;
  currency: string;
  lineItems: LineItem[];
  shippingAddress: Address | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
};

export type CheckoutStatus = 'active' | 'completed' | 'abandoned' | 'unknown';

export type Checkout = {
  id: string;
  ref: PlatformRef;
  customerId: string | null;
  email: string | null;
  phone: string | null;
  status: CheckoutStatus;
  lineItems: LineItem[];
  totalPrice: number;
  currency: string;
  checkoutUrl: string | null;
  lastActivityAt: Date;
  completedAt: Date | null;
  createdAt: Date;
};

export type Product = {
  id: string;
  ref: PlatformRef;
  title: string;
  description: string | null;
  vendor: string | null;
  productType: string | null;
  status: 'active' | 'draft' | 'archived';
  variants: ProductVariant[];
  images: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type ProductVariant = {
  id: string;
  sku: string | null;
  title: string;
  price: number;
  compareAtPrice: number | null;
  inventoryQuantity: number | null;
  weight: number | null;
  options: Record<string, string>;
};

export type LineItem = {
  productId: string | null;
  variantId: string | null;
  sku: string | null;
  title: string;
  quantity: number;
  price: number;
  totalPrice: number;
  imageUrl: string | null;
};

export type Address = {
  firstName: string | null;
  lastName: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  zip: string | null;
  country: string;
};

// ============================================================
// RATE LIMITER INTERFACE
// ============================================================

export interface IRateLimiter {
  acquire(): Promise<void>;
  tryAcquire(): Promise<boolean>;
  getWaitTime(): number;
}

// ============================================================
// ADAPTER INTERFACE
// ============================================================

export interface IEcommerceAdapter {
  // Lifecycle
  connect(credentials: PlatformCredentials): Promise<ConnectionResult>;
  disconnect(storeId: string): Promise<void>;
  healthCheck(storeId: string): Promise<HealthStatus>;

  // Data Fetch (paginated, rate-limit-aware)
  fetchCustomers(params: FetchParams): AsyncGenerator<Customer[]>;
  fetchOrders(params: FetchParams): AsyncGenerator<Order[]>;
  fetchProducts(params: FetchParams): AsyncGenerator<Product[]>;
  fetchCheckouts(params: FetchParams): AsyncGenerator<Checkout[]>;

  // Webhooks
  registerWebhooks(storeId: string, topics: WebhookTopic[]): Promise<WebhookRegistration[]>;
  verifyWebhookSignature(headers: Record<string, string>, rawBody: Buffer): boolean;
  normalizeWebhookEvent(topic: string, payload: unknown): InternalEvent | null;

  // Sync State
  getSyncCursor(storeId: string, resource: 'customers' | 'orders' | 'products' | 'checkouts'): Promise<SyncCursor | null>;
  setSyncCursor(storeId: string, resource: 'customers' | 'orders' | 'products' | 'checkouts', cursor: SyncCursor): Promise<void>;
}

// ============================================================
// STORE CONFIG TYPES (for database)
// ============================================================

export type CartTrackingMode = 'plugin' | 'pixel' | 'none';

export type StoreConfig = {
  id: string;
  tenantId: string;
  platform: Platform;
  storeName: string;
  storeUrl: string;
  credentialsEncrypted: string; // AES-256-GCM encrypted JSON
  cartTrackingMode: CartTrackingMode;
  abandonmentWindowMinutes: number;
  status: 'connected' | 'disconnected' | 'unreachable' | 'pending';
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// ============================================================
// SYNC JOB TYPES
// ============================================================

export type SyncJobStatus = 'pending' | 'running' | 'paused' | 'complete' | 'failed';

export type SyncJob = {
  id: string;
  storeId: string;
  platform: Platform;
  resource: 'customers' | 'orders' | 'products' | 'checkouts';
  startedAt: Date;
  cursor: SyncCursor | null;
  status: SyncJobStatus;
  recordsProcessed: number;
  errors: string[];
  createdAt: Date;
  completedAt: Date | null;
};

export type ResourceType = 'customers' | 'orders' | 'products' | 'checkouts';