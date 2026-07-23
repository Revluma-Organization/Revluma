import os
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

class Settings:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    REDIS_URL: str = os.getenv("REDIS_URL", "")
    MLFLOW_TRACKING_URI: str = os.getenv("MLFLOW_TRACKING_URI", "")


settings = Settings()