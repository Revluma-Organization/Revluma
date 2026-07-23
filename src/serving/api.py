import os
import sys
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional, Dict, Any
from datetime import datetime
import importlib.metadata
import dotenv

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field, validator
import uvicorn


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

dotenv.load_dotenv(dotenv.find_dotenv())

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('woocommerce_api')

app = FastAPI(
    title="Synchronization Service",
    description="Internal API for triggering e-commerce platform synchronization",
    version="1.0.0"
)

executor = ThreadPoolExecutor(max_workers=4)


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



@app.post("/internal/sync/trigger")
async def trigger_sync(request: SyncTriggerRequest):
    """
    Internal endpoint to trigger background synchronization.
    This endpoint is only accessible from trusted internal networks.
    """
    logger.info(f"Received sync trigger request: store_id={request.store_id}, platform={request.platform}")

    try:
        
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



class HealthResponse(BaseModel):
    """Health check response model."""
    status: str
    service_name: str
    service_version: str
    timestamp: str
    database_configured: bool
    database_url: Optional[str] = None  
    loaded_models: List[str] = []
    active_platforms: List[str] = []

@app.get("/health")
async def health_check():
    """
    Enhanced health check endpoint with runtime diagnostics.
    """
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
    # TODO: Add actual model cache inspection
    # if hasattr(app.state, 'model_cache'):
    #     loaded_models = list(app.state.model_cache.keys())

    active_platforms = ['woocommerce']
    # Checking if other sync modules exist
    try:
        import src.services.woocommerce_sync
        active_platforms.append('woocommerce')
    except ImportError:
        pass
    
    try:
        import src.services.shopify_sync
        active_platforms.append('shopify')
    except ImportError:
        pass

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


@app.get("/")
async def root():
    """Root endpoint showing service info."""
    return {
        "service": "Synchronization Service",
        "version": app.version,
        "endpoints": {
            "/health": "Service health diagnostics",
            "/internal/sync/trigger": "Internal sync trigger",
            "/": "Service information"
        }
    }



class IPAllowListMiddleware:
    """
    Middleware to restrict access to internal endpoints.
    Only allows requests from specified IPs.
    """
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
        
        # Checking if endpoint is internal
        path = scope.get('path', '')
        if path.startswith('/internal/'):
            # Checking if IP is allowed
            if not self._is_allowed(client_ip):
                # Return 403 Forbidden
                response = HTTPException(
                    status_code=403,
                    detail="Access denied: internal endpoint restricted"
                )
                await response(scope, receive, send)
                return
        
        await self.app(scope, receive, send)
    
    def _is_allowed(self, ip: str) -> bool:
        # Simple IP matching
        if ip in self.allowed_ips:
            return True
        
        # Checking for localhost variations
        if ip == '127.0.0.1' and 'localhost' in self.allowed_ips:
            return True
        if ip == '::1' and 'localhost' in self.allowed_ips:
            return True
        
        # TODO: 
        return False

if os.getenv('ENV') == 'production':
    app.add_middleware(
        IPAllowListMiddleware,
        allowed_ips=['127.0.0.1', '::1', 'localhost']
    )
    logger.info("IP allow-list middleware enabled for production")
else:
    logger.info("Running in development mode - IP restrictions disabled")


@app.on_event("startup")
async def startup_event():
    """Actions to perform on service startup."""
    logger.info("Synchronization service starting up...")
    logger.info(f"Database configured: {bool(os.getenv('DATABASE_URL'))}")
    
    try:
        import src.services.woocommerce_sync
        logger.info("WooCommerce sync service loaded successfully")
    except ImportError as e:
        logger.warning(f"WooCommerce sync service not available: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up on service shutdown."""
    logger.info("Synchronization service shutting down...")
    executor.shutdown(wait=True)
    logger.info("Thread pool executor shut down")



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